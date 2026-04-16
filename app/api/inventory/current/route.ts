import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { splitStock } from '@/lib/stock-utils'
import { authOptions } from '@/lib/auth'
import { toUtcNoonDate } from '@/lib/date-utils'

export const dynamic = 'force-dynamic'

export async function GET() {
  // ── 1. Fetch the latest inventory session (1 query) ──────────────────────
  const latestSession = await prisma.inventorySession.findFirst({
    orderBy: { periodStart: 'desc' },
  })

  const sessionId    = latestSession?.id ?? null
  const periodStart  = latestSession?.periodStart ?? null
  const periodEnd    = latestSession?.periodEnd   ?? null

  // ── 2. Bulk-fetch everything in parallel (5 queries total) ───────────────
  const [productSizes, openingEntries, receiptItems, salesAgg, adjAgg] = await Promise.all([
    // All product sizes + product info
    prisma.productSize.findMany({
      include: { product: true },
      orderBy: [{ product: { category: 'asc' } }, { product: { name: 'asc' } }, { sizeMl: 'desc' }],
    }),

    // Opening stock entries for this session
    sessionId
      ? prisma.stockEntry.findMany({
          where: { sessionId, entryType: 'OPENING' },
          select: { productSizeId: true, totalBottles: true },
        })
      : Promise.resolve([]),

    // Receipts within session period (or all time if no session)
    periodStart
      ? prisma.receiptItem.findMany({
          where: {
            receipt: {
              receivedDate: {
                gte: periodStart,
                lte: periodEnd && periodEnd < new Date() ? periodEnd : new Date('2099-01-01'),
              },
            },
          },
          select: { productSizeId: true, totalBottles: true },
        })
      : prisma.receiptItem.findMany({ select: { productSizeId: true, totalBottles: true } }),

    // Sales since session start (or all time) — group by productSizeId
    // quantityBottles > 0 excludes VOID rows (which store negative qty) without
    // requiring the VOID enum value to exist in the DB yet.
    prisma.sale.groupBy({
      by: ['productSizeId'],
      where: {
        ...(periodStart ? { saleDate: { gte: periodStart } } : {}),
        quantityBottles: { gt: 0 },
      },
      _sum: { quantityBottles: true },
    }),

    // Approved stock adjustments since session start (or all time)
    prisma.stockAdjustment.groupBy({
      by: ['productSizeId'],
      where: {
        approved: true,
        ...(periodStart ? { adjustmentDate: { gte: periodStart } } : {}),
      },
      _sum: { quantityBottles: true },
    }),
  ])

  // ── 3. Build lookup maps ─────────────────────────────────────────────────
  const openingMap = new Map<number, number>()
  for (const e of openingEntries) openingMap.set(e.productSizeId, e.totalBottles ?? 0)

  const receiptMap = new Map<number, number>()
  for (const r of receiptItems) receiptMap.set(r.productSizeId, (receiptMap.get(r.productSizeId) ?? 0) + r.totalBottles)

  const salesMap = new Map<number, number>()
  for (const s of salesAgg) salesMap.set(s.productSizeId, s._sum.quantityBottles ?? 0)

  const adjMap = new Map<number, number>()
  for (const a of adjAgg) adjMap.set(a.productSizeId, a._sum.quantityBottles ?? 0)

  // ── 4. Compute current stock per product in memory ───────────────────────
  const stock = productSizes.map(ps => {
    const opening     = openingMap.get(ps.id) ?? 0
    const receipts    = receiptMap.get(ps.id) ?? 0
    const sold        = salesMap.get(ps.id)   ?? 0
    const adjustments = adjMap.get(ps.id)     ?? 0
    const currentStock = opening + receipts + adjustments - sold

    return {
      id: ps.id,
      productId: ps.productId,
      productName: ps.product.name,
      category: ps.product.category,
      sizeMl: ps.sizeMl,
      bottlesPerCase: ps.bottlesPerCase,
      sellingPrice: ps.sellingPrice,
      mrp: ps.mrp,
      barcode: ps.barcode,
      currentStock,
      ...splitStock(currentStock, ps.bottlesPerCase),
    }
  })

  return NextResponse.json(stock)
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { id?: string; role?: string } | undefined

  if (!session || user?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Only admins can edit stock' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const productSizeId = Number(body?.productSizeId)
  const newStock = Number(body?.newStock)
  const reasonInput = typeof body?.reason === 'string' ? body.reason.trim() : ''

  if (!Number.isInteger(productSizeId) || productSizeId <= 0) {
    return NextResponse.json({ error: 'Invalid productSizeId' }, { status: 400 })
  }
  if (!Number.isInteger(newStock) || newStock < 0) {
    return NextResponse.json({ error: 'newStock must be a non-negative integer' }, { status: 400 })
  }

  const ps = await prisma.productSize.findUnique({ where: { id: productSizeId }, include: { product: true } })
  if (!ps) {
    return NextResponse.json({ error: 'Product size not found' }, { status: 404 })
  }

  // Compute current stock inline (re-uses same bulk logic but for one product)
  const latestSession = await prisma.inventorySession.findFirst({ orderBy: { periodStart: 'desc' } })
  const periodStart = latestSession?.periodStart ?? null

  const [openingEntry, receiptAgg, salesAggSingle, adjAggSingle] = await Promise.all([
    latestSession
      ? prisma.stockEntry.findUnique({
          where: { sessionId_productSizeId_entryType: { sessionId: latestSession.id, productSizeId, entryType: 'OPENING' } },
        })
      : Promise.resolve(null),
    prisma.receiptItem.aggregate({
      where: { productSizeId, ...(periodStart ? { receipt: { receivedDate: { gte: periodStart } } } : {}) },
      _sum: { totalBottles: true },
    }),
    prisma.sale.aggregate({
      where: { productSizeId, quantityBottles: { gt: 0 }, ...(periodStart ? { saleDate: { gte: periodStart } } : {}) },
      _sum: { quantityBottles: true },
    }),
    prisma.stockAdjustment.aggregate({
      where: { productSizeId, approved: true, ...(periodStart ? { adjustmentDate: { gte: periodStart } } : {}) },
      _sum: { quantityBottles: true },
    }),
  ])

  const currentStock =
    (openingEntry?.totalBottles ?? 0) +
    (receiptAgg._sum.totalBottles ?? 0) +
    (adjAggSingle._sum.quantityBottles ?? 0) -
    (salesAggSingle._sum.quantityBottles ?? 0)

  const delta = newStock - currentStock
  if (delta === 0) {
    return NextResponse.json({ success: true, message: 'No stock change required', productSizeId, currentStock, updatedStock: currentStock })
  }

  let createdById = Number.parseInt(user?.id ?? '', 10)
  if (!Number.isInteger(createdById) || createdById <= 0) {
    const fallbackAdmin = await prisma.staff.findFirst({ where: { role: 'ADMIN', active: true }, select: { id: true } })
    if (!fallbackAdmin) return NextResponse.json({ error: 'No active admin staff account available for audit trail' }, { status: 400 })
    createdById = fallbackAdmin.id
  }

  const reason = reasonInput || `Manual stock correction by admin (${currentStock} -> ${newStock})`
  await prisma.stockAdjustment.create({
    data: {
      adjustmentDate: toUtcNoonDate(new Date()),
      productSizeId,
      adjustmentType: 'CORRECTION',
      quantityBottles: delta,
      reason,
      createdById,
      approvedById: createdById,
      approved: true,
    },
  })

  return NextResponse.json({ success: true, productSizeId, currentStock, updatedStock: newStock, delta, productName: ps.product.name, sizeMl: ps.sizeMl })
}
