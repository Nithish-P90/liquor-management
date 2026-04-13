import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'

export const dynamic = 'force-dynamic'

/**
 * Compute closing stock for a session dynamically:
 *   closing = opening + receipts + adjustments - sales
 *
 * This works in real-time throughout the day and does NOT require
 * manual CLOSING stock entry. The result is grouped by category.
 */
async function computeClosingStockByCategory(
  sessionId: number,
  periodStart: Date,
  periodEnd: Date
): Promise<{ summary: Record<string, { totalBottles: number; value: number }>; totalBottles: number }> {
  // Boundary: use periodEnd OR now, whichever is earlier, so today's session is live
  const now = new Date()
  const boundary = periodEnd < now ? periodEnd : now

  // Fetch all product sizes with opening entries for this session
  const openingEntries = await prisma.stockEntry.findMany({
    where: { sessionId, entryType: 'OPENING' },
    include: { productSize: { include: { product: true } } },
  })

  // Also gather product sizes that have had sales or receipts this session
  // (they may have 0 opening stock)
  const [salesInSession, receiptsInSession] = await Promise.all([
    prisma.sale.findMany({
      where: { saleDate: { gte: periodStart, lte: boundary } },
      select: { productSizeId: true },
      distinct: ['productSizeId'],
    }),
    prisma.receiptItem.findMany({
      where: { receipt: { receivedDate: { gte: periodStart, lte: boundary } } },
      select: { productSizeId: true },
      distinct: ['productSizeId'],
    }),
  ])

  // Build unique set of all relevant productSizeIds
  const psIds = new Set<number>([
    ...openingEntries.map(e => e.productSizeId),
    ...salesInSession.map(s => s.productSizeId),
    ...receiptsInSession.map(r => r.productSizeId),
  ])

  if (psIds.size === 0) {
    return { summary: {}, totalBottles: 0 }
  }

  const psIdArr = Array.from(psIds)

  // Fetch all product size details for the set
  const productSizes = await prisma.productSize.findMany({
    where: { id: { in: psIdArr } },
    include: { product: true },
  })

  // Build opening lookup
  const openingMap = new Map(openingEntries.map(e => [e.productSizeId, e.totalBottles]))

  // Batch fetch receipts, sales, adjustments for all relevant product sizes
  const [receiptItems, salesAgg, adjAgg] = await Promise.all([
    prisma.receiptItem.findMany({
      where: {
        productSizeId: { in: psIdArr },
        receipt: { receivedDate: { gte: periodStart, lte: boundary } },
      },
      select: { productSizeId: true, totalBottles: true },
    }),
    prisma.sale.groupBy({
      by: ['productSizeId'],
      where: {
        productSizeId: { in: psIdArr },
        saleDate: { gte: periodStart, lte: boundary },
      },
      _sum: { quantityBottles: true },
    }),
    prisma.stockAdjustment.groupBy({
      by: ['productSizeId'],
      where: {
        productSizeId: { in: psIdArr },
        approved: true,
        adjustmentDate: { gte: periodStart, lte: boundary },
      },
      _sum: { quantityBottles: true },
    }),
  ])

  // Build lookup maps
  const receiptMap = new Map<number, number>()
  for (const r of receiptItems) {
    receiptMap.set(r.productSizeId, (receiptMap.get(r.productSizeId) ?? 0) + r.totalBottles)
  }
  const salesMap = new Map(salesAgg.map(s => [s.productSizeId, s._sum.quantityBottles ?? 0]))
  const adjMap = new Map(adjAgg.map(a => [a.productSizeId, a._sum.quantityBottles ?? 0]))

  // Compute closing per product size, grouped by category
  const summary: Record<string, { totalBottles: number; value: number }> = {}
  let grandTotal = 0

  for (const ps of productSizes) {
    const opening = openingMap.get(ps.id) ?? 0
    const receipts = receiptMap.get(ps.id) ?? 0
    const sold = salesMap.get(ps.id) ?? 0
    const adj = adjMap.get(ps.id) ?? 0
    const closing = Math.max(0, opening + receipts + adj - sold)

    if (closing === 0 && opening === 0 && receipts === 0) continue

    const cat = ps.product.category
    if (!summary[cat]) summary[cat] = { totalBottles: 0, value: 0 }
    summary[cat].totalBottles += closing
    summary[cat].value += closing * Number(ps.sellingPrice)
    grandTotal += closing
  }

  return { summary, totalBottles: grandTotal }
}

export async function GET() {
  try {
    const sessions = await prisma.inventorySession.findMany({
      orderBy: { periodStart: 'desc' },
      take: 30,
    })

    const today = toUtcNoonDate(new Date())
    const results = []

    for (const session of sessions) {
      const dateOnly = toUtcNoonDate(session.periodStart)
      const isToday = dateOnly.getTime() === today.getTime()

      // Sales for this date
      const salesAgg = await prisma.sale.groupBy({
        by: ['paymentMode'],
        where: { saleDate: dateOnly },
        _sum: { totalAmount: true, quantityBottles: true },
        _count: { _all: true },
      })

      let totalSalesAmount = 0
      let totalBottlesSold = 0
      let totalBills = 0
      const salesByMode: Record<string, number> = { CASH: 0, UPI: 0, CARD: 0, CREDIT: 0, SPLIT: 0 }

      for (const group of salesAgg) {
        const amount = Number(group._sum.totalAmount ?? 0)
        salesByMode[group.paymentMode] += amount
        totalSalesAmount += amount
        totalBottlesSold += group._sum.quantityBottles ?? 0
        totalBills += group._count._all
      }

      // Expenses for this date
      const expAgg = await prisma.expenditure.aggregate({
        where: { expDate: dateOnly },
        _sum: { amount: true },
      })
      const totalExpenses = Number(expAgg._sum.amount ?? 0)

      // Indent receipts for this date
      const receiptAgg = await prisma.receiptItem.aggregate({
        where: { receipt: { receivedDate: dateOnly } },
        _sum: { totalBottles: true },
      })
      const indentBottles = receiptAgg._sum.totalBottles ?? 0
      const indentValue = 0 // cost not tracked per-receipt; use indent items if needed

      // Closing stock: always computed dynamically
      const { summary: closingStock, totalBottles: closingTotal } =
        await computeClosingStockByCategory(session.id, session.periodStart, session.periodEnd)

      results.push({
        sessionId: session.id,
        date: session.periodStart,
        isLive: isToday,
        financials: {
          totalSales: totalSalesAmount,
          totalExpenses,
          netCash: salesByMode.CASH - totalExpenses,
          salesByMode,
          totalBottlesSold,
          totalBills,
        },
        indents: { totalBottles: indentBottles, totalValue: indentValue },
        closingStock,
        closingTotal,
        hasClosingStock: closingTotal > 0 || Object.keys(closingStock).length > 0,
      })
    }

    return NextResponse.json(results)
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to fetch daily ledger' }, { status: 500 })
  }
}
