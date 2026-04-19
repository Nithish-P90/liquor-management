import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { ensureDailyRollover } from '@/lib/rollover'

export const dynamic = 'force-dynamic'

export async function GET() {
  await ensureDailyRollover()

  // Fire productSizes + session lookup in parallel
  const [productSizes, session] = await Promise.all([
    prisma.productSize.findMany({
      where: { product: { category: { not: 'MISCELLANEOUS' } } },
      include: { product: true },
      orderBy: [
        { product: { category: 'asc' } },
        { product: { name: 'asc' } },
        { sizeMl: 'desc' },
      ],
    }),
    prisma.inventorySession.findFirst({
      orderBy: { periodStart: 'desc' },
      select: { id: true, periodStart: true },
    }),
  ])

  const sessionStart = session?.periodStart ?? new Date(0)

  // Batch all aggregations in parallel with raw SQL for speed
  const [openingEntries, receiptAgg, salesAgg, adjAgg, pendingAgg] = await Promise.all([
    session
      ? prisma.stockEntry.findMany({
          where: { sessionId: session.id, entryType: 'OPENING' },
          select: { productSizeId: true, totalBottles: true },
        })
      : Promise.resolve([]),

    prisma.receiptItem.groupBy({
      by: ['productSizeId'],
      where: { receipt: { receivedDate: { gte: sessionStart } } },
      _sum: { totalBottles: true },
    }),

    prisma.sale.groupBy({
      by: ['productSizeId'],
      where: { saleDate: { gte: sessionStart }, quantityBottles: { not: 0 } },
      _sum: { quantityBottles: true },
    }),

    prisma.stockAdjustment.groupBy({
      by: ['productSizeId'],
      where: { approved: true, adjustmentDate: { gte: sessionStart } },
      _sum: { quantityBottles: true },
    }),

    prisma.pendingBillItem.groupBy({
      by: ['productSizeId'],
      where: {
        bill: { settled: false, saleDate: { gte: sessionStart } },
      },
      _sum: { quantityBottles: true },
    }),
  ])

  // Build O(1) lookup maps
  const openingMap = new Map<number, number>()
  for (const e of openingEntries) openingMap.set(e.productSizeId, e.totalBottles)

  const receiptMap = new Map<number, number>()
  for (const r of receiptAgg) receiptMap.set(r.productSizeId, r._sum.totalBottles ?? 0)

  const salesMap = new Map<number, number>()
  for (const s of salesAgg) salesMap.set(s.productSizeId, s._sum.quantityBottles ?? 0)

  const adjMap = new Map<number, number>()
  for (const a of adjAgg) adjMap.set(a.productSizeId, a._sum.quantityBottles ?? 0)

  const pendingMap = new Map<number, number>()
  for (const p of pendingAgg) pendingMap.set(p.productSizeId, p._sum.quantityBottles ?? 0)

  const result = productSizes.map(ps => {
    const opening = openingMap.get(ps.id) ?? 0
    const receipts = receiptMap.get(ps.id) ?? 0
    const sold = salesMap.get(ps.id) ?? 0
    const adj = adjMap.get(ps.id) ?? 0
    const pending = pendingMap.get(ps.id) ?? 0
    const computedStock = Math.max(0, opening + receipts + adj - sold - pending)
    const currentStock = ps.product.category === 'MISCELLANEOUS' ? 999999 : computedStock

    return {
      id: ps.id,
      sizeMl: ps.sizeMl,
      bottlesPerCase: ps.bottlesPerCase,
      mrp: Number(ps.mrp),
      sellingPrice: Number(ps.sellingPrice),
      barcode: ps.barcode,
      currentStock,
      product: {
        id: ps.product.id,
        name: ps.product.name,
        category: ps.product.category,
        itemCode: ps.product.itemCode,
      },
    }
  })

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
