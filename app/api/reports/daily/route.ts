import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // 1. Get all inventory sessions (each represents a Day's ledger)
    const sessions = await prisma.inventorySession.findMany({
      orderBy: { periodStart: 'desc' },
      take: 30, // Last 30 days
      include: {
        stockEntries: {
          where: { entryType: 'CLOSING' },
          include: {
            productSize: {
              include: { product: true },
            },
          },
        },
      },
    })

    const results = []

    for (const session of sessions) {
      const dateOnly = toUtcNoonDate(session.periodStart)

      // 2. Fetch Sales for this date
      const salesAgg = await prisma.sale.groupBy({
        by: ['paymentMode'],
        where: { saleDate: dateOnly },
        _sum: { totalAmount: true, quantityBottles: true },
        _count: { _all: true },
      })

      let totalSalesAmount = 0
      let totalBottlesSold = 0
      let totalBills = 0
      const salesByMode: Record<string, number> = {
        CASH: 0, UPI: 0, CARD: 0, CREDIT: 0, SPLIT: 0
      }

      for (const group of salesAgg) {
        const amount = Number(group._sum.totalAmount ?? 0)
        salesByMode[group.paymentMode] += amount
        totalSalesAmount += amount
        totalBottlesSold += group._sum.quantityBottles ?? 0
        totalBills += group._count._all
      }

      // 3. Fetch Expenses for this date
      const expAgg = await prisma.expenditure.aggregate({
        where: { expDate: dateOnly },
        _sum: { amount: true },
      })
      const totalExpenses = Number(expAgg._sum.amount ?? 0)

      // 4. Fetch Indent Receipts for this date
      const receiptAgg = await prisma.receiptItem.aggregate({
        where: { receipt: { receivedDate: dateOnly } },
        _sum: { totalBottles: true, costAmount: true },
      })
      const indentBottles = receiptAgg._sum.totalBottles ?? 0
      const indentValue = Number(receiptAgg._sum.costAmount ?? 0)

      // 5. Summarize Closing Stock by Category
      const stockSummary: Record<string, { totalBottles: number; value: number }> = {}

      for (const entry of session.stockEntries) {
        const cat = entry.productSize.product.category
        const val = Number(entry.productSize.sellingPrice) * entry.totalBottles
        
        if (!stockSummary[cat]) {
          stockSummary[cat] = { totalBottles: 0, value: 0 }
        }
        stockSummary[cat].totalBottles += entry.totalBottles
        stockSummary[cat].value += val
      }

      results.push({
        sessionId: session.id,
        date: session.periodStart,
        financials: {
          totalSales: totalSalesAmount,
          totalExpenses,
          netCash: salesByMode.CASH - totalExpenses,
          salesByMode,
          totalBottlesSold,
          totalBills,
        },
        indents: {
          totalBottles: indentBottles,
          totalValue: indentValue,
        },
        closingStock: stockSummary,
        hasClosingStock: session.stockEntries.length > 0,
      })
    }

    return NextResponse.json(results)
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to fetch daily ledger' }, { status: 500 })
  }
}
