import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'

export const dynamic = 'force-dynamic'

/**
 * POST /api/inventory/carry-forward
 *
 * Creates a new session and rolls the previous session's closing stock
 * forward as the new session's opening stock.
 *
 * Closing stock is computed dynamically:
 *   closing = opening + receipts + approved-adjustments - sales
 *
 * This means carry-forward works even without a manual CLOSING entry,
 * so you never need to enter closing stock manually — the system
 * calculates it from the day's activity and rolls it forward.
 *
 * Body: { periodStart?, periodEnd? }
 */
export async function POST(req: NextRequest) {
  const auth = await getServerSession(authOptions)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = auth.user as { id?: string; role?: string }
  if (user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const today = toUtcNoonDate(new Date())
  const periodStart = body.periodStart ? new Date(body.periodStart) : today
  const periodEnd = body.periodEnd ? new Date(body.periodEnd) : today

  // Find the most recent session (the one we're closing out)
  const lastSession = await prisma.inventorySession.findFirst({
    orderBy: { periodEnd: 'desc' },
  })

  if (!lastSession) {
    return NextResponse.json(
      { error: 'No previous session found. Please create an opening stock entry manually first.' },
      { status: 400 }
    )
  }

  // Compute computed closing stock for each product size in the last session
  // Formula: opening + receipts + approved_adjustments - sales
  const openingEntries = await prisma.stockEntry.findMany({
    where: { sessionId: lastSession.id, entryType: 'OPENING' },
  })

  // Gather all product sizes that had any activity during the last session
  const [salesInSession, receiptsInSession] = await Promise.all([
    prisma.sale.findMany({
      where: { saleDate: { gte: lastSession.periodStart, lte: lastSession.periodEnd } },
      select: { productSizeId: true },
      distinct: ['productSizeId'],
    }),
    prisma.receiptItem.findMany({
      where: { receipt: { receivedDate: { gte: lastSession.periodStart, lte: lastSession.periodEnd } } },
      select: { productSizeId: true },
      distinct: ['productSizeId'],
    }),
  ])

  const psIds = new Set<number>([
    ...openingEntries.map(e => e.productSizeId),
    ...salesInSession.map(s => s.productSizeId),
    ...receiptsInSession.map(r => r.productSizeId),
  ])

  if (psIds.size === 0) {
    // Check if there are manual CLOSING entries as fallback
    const manualClosing = await prisma.stockEntry.findMany({
      where: { sessionId: lastSession.id, entryType: 'CLOSING' },
    })
    if (manualClosing.length === 0) {
      return NextResponse.json(
        { error: 'No stock activity found for the previous session. Cannot carry forward.' },
        { status: 400 }
      )
    }

    // Use manual CLOSING entries
    const newSession = await prisma.inventorySession.create({
      data: { periodStart, periodEnd, staffId: parseInt(user.id ?? '1') },
    })
    let copiedCount = 0
    for (const entry of manualClosing) {
      if (entry.totalBottles === 0) continue
      await prisma.stockEntry.create({
        data: {
          sessionId: newSession.id,
          productSizeId: entry.productSizeId,
          entryType: 'OPENING',
          cases: entry.cases,
          bottles: entry.bottles,
          totalBottles: entry.totalBottles,
        },
      })
      copiedCount++
    }
    return NextResponse.json({
      newSessionId: newSession.id,
      copiedFromSessionId: lastSession.id,
      entriesCopied: copiedCount,
      source: 'manual_closing',
      periodStart: newSession.periodStart,
      periodEnd: newSession.periodEnd,
    })
  }

  const psIdArr = Array.from(psIds)

  // Batch fetch receipts, sales, adjustments for all product sizes in last session
  const [receiptItems, salesAgg, adjAgg] = await Promise.all([
    prisma.receiptItem.findMany({
      where: {
        productSizeId: { in: psIdArr },
        receipt: { receivedDate: { gte: lastSession.periodStart, lte: lastSession.periodEnd } },
      },
      select: { productSizeId: true, totalBottles: true },
    }),
    prisma.sale.groupBy({
      by: ['productSizeId'],
      where: {
        productSizeId: { in: psIdArr },
        saleDate: { gte: lastSession.periodStart, lte: lastSession.periodEnd },
      },
      _sum: { quantityBottles: true },
    }),
    prisma.stockAdjustment.groupBy({
      by: ['productSizeId'],
      where: {
        productSizeId: { in: psIdArr },
        approved: true,
        adjustmentDate: { gte: lastSession.periodStart, lte: lastSession.periodEnd },
      },
      _sum: { quantityBottles: true },
    }),
  ])

  const openingMap = new Map(openingEntries.map(e => [e.productSizeId, e]))
  const receiptMap = new Map<number, number>()
  for (const r of receiptItems) {
    receiptMap.set(r.productSizeId, (receiptMap.get(r.productSizeId) ?? 0) + r.totalBottles)
  }
  const salesMap = new Map(salesAgg.map(s => [s.productSizeId, s._sum.quantityBottles ?? 0]))
  const adjMap = new Map(adjAgg.map(a => [a.productSizeId, a._sum.quantityBottles ?? 0]))

  // Fetch bottlesPerCase for each product size
  const productSizes = await prisma.productSize.findMany({
    where: { id: { in: psIdArr } },
    select: { id: true, bottlesPerCase: true },
  })
  const bpcMap = new Map(productSizes.map(ps => [ps.id, ps.bottlesPerCase]))

  // Compute closing for each product size
  const computedClosing: { productSizeId: number; totalBottles: number; cases: number; bottles: number }[] = []
  for (const psId of psIdArr) {
    const opening = openingMap.get(psId)?.totalBottles ?? 0
    const receipts = receiptMap.get(psId) ?? 0
    const sold = salesMap.get(psId) ?? 0
    const adj = adjMap.get(psId) ?? 0
    const closingTotal = Math.max(0, opening + receipts + adj - sold)

    if (closingTotal === 0) continue

    const bpc = bpcMap.get(psId) ?? 12
    computedClosing.push({
      productSizeId: psId,
      totalBottles: closingTotal,
      cases: Math.floor(closingTotal / bpc),
      bottles: closingTotal % bpc,
    })
  }

  if (computedClosing.length === 0) {
    return NextResponse.json(
      { error: 'Computed closing stock is zero for all products. Nothing to carry forward.' },
      { status: 400 }
    )
  }

  // Create the new session
  const newSession = await prisma.inventorySession.create({
    data: { periodStart, periodEnd, staffId: parseInt(user.id ?? '1') },
  })

  // Write computed closing as OPENING entries for the new session
  let copiedCount = 0
  for (const entry of computedClosing) {
    await prisma.stockEntry.create({
      data: {
        sessionId: newSession.id,
        productSizeId: entry.productSizeId,
        entryType: 'OPENING',
        cases: entry.cases,
        bottles: entry.bottles,
        totalBottles: entry.totalBottles,
      },
    })
    copiedCount++
  }

  // Also persist the computed closing as CLOSING entries on the old session
  // (for audit trail — upsert to avoid conflicts with any manual entries)
  for (const entry of computedClosing) {
    await prisma.stockEntry.upsert({
      where: {
        sessionId_productSizeId_entryType: {
          sessionId: lastSession.id,
          productSizeId: entry.productSizeId,
          entryType: 'CLOSING',
        },
      },
      create: {
        sessionId: lastSession.id,
        productSizeId: entry.productSizeId,
        entryType: 'CLOSING',
        cases: entry.cases,
        bottles: entry.bottles,
        totalBottles: entry.totalBottles,
      },
      update: {
        cases: entry.cases,
        bottles: entry.bottles,
        totalBottles: entry.totalBottles,
      },
    })
  }

  return NextResponse.json({
    newSessionId: newSession.id,
    copiedFromSessionId: lastSession.id,
    entriesCopied: copiedCount,
    source: 'computed',
    periodStart: newSession.periodStart,
    periodEnd: newSession.periodEnd,
  })
}
