import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/rollover
 * Triggered by Vercel Cron at 18:30 UTC (midnight IST) every day.
 * Rolls over the current session's closing stock into the next day's opening stock.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // IST midnight = today's date in IST
  const now = new Date()
  // periodStart/End = today at noon UTC (used as the date key)
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 6, 30, 0)) // 6:30 UTC = 12:00 IST

  // Don't create a duplicate session for today
  const existingToday = await prisma.inventorySession.findFirst({
    where: { periodStart: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)) } },
  })
  if (existingToday) {
    return NextResponse.json({ message: 'Session already exists for today', sessionId: existingToday.id })
  }

  const lastSession = await prisma.inventorySession.findFirst({
    orderBy: { periodEnd: 'desc' },
  })
  if (!lastSession) {
    return NextResponse.json({ error: 'No previous session to roll over from' }, { status: 400 })
  }

  const admin = await prisma.staff.findFirst({ where: { role: 'ADMIN' } })
  const staffId = admin?.id ?? 1

  // Gather all product sizes with activity in last session
  const openingEntries = await prisma.stockEntry.findMany({
    where: { sessionId: lastSession.id, entryType: 'OPENING' },
  })
  const [salesInSession, receiptsInSession] = await Promise.all([
    prisma.sale.findMany({
      where: { saleDate: { gte: lastSession.periodStart, lte: lastSession.periodEnd } },
      select: { productSizeId: true }, distinct: ['productSizeId'],
    }),
    prisma.receiptItem.findMany({
      where: { receipt: { receivedDate: { gte: lastSession.periodStart, lte: lastSession.periodEnd } } },
      select: { productSizeId: true }, distinct: ['productSizeId'],
    }),
  ])

  const psIds = new Set<number>([
    ...openingEntries.map(e => e.productSizeId),
    ...salesInSession.map(s => s.productSizeId),
    ...receiptsInSession.map(r => r.productSizeId),
  ])

  if (psIds.size === 0) {
    return NextResponse.json({ error: 'No stock activity in previous session' }, { status: 400 })
  }

  const psIdArr = Array.from(psIds)
  const [receiptItems, salesAgg, adjAgg, productSizes] = await Promise.all([
    prisma.receiptItem.findMany({
      where: { productSizeId: { in: psIdArr }, receipt: { receivedDate: { gte: lastSession.periodStart, lte: lastSession.periodEnd } } },
      select: { productSizeId: true, totalBottles: true },
    }),
    prisma.sale.groupBy({
      by: ['productSizeId'],
      where: { productSizeId: { in: psIdArr }, saleDate: { gte: lastSession.periodStart, lte: lastSession.periodEnd }, quantityBottles: { gt: 0 } },
      _sum: { quantityBottles: true },
    }),
    prisma.stockAdjustment.groupBy({
      by: ['productSizeId'],
      where: { productSizeId: { in: psIdArr }, approved: true, adjustmentDate: { gte: lastSession.periodStart, lte: lastSession.periodEnd } },
      _sum: { quantityBottles: true },
    }),
    prisma.productSize.findMany({ where: { id: { in: psIdArr } }, select: { id: true, bottlesPerCase: true } }),
  ])

  const openingMap = new Map(openingEntries.map(e => [e.productSizeId, e]))
  const receiptMap = new Map<number, number>()
  for (const r of receiptItems) receiptMap.set(r.productSizeId, (receiptMap.get(r.productSizeId) ?? 0) + r.totalBottles)
  const salesMap = new Map(salesAgg.map(s => [s.productSizeId, s._sum.quantityBottles ?? 0]))
  const adjMap = new Map(adjAgg.map(a => [a.productSizeId, a._sum.quantityBottles ?? 0]))
  const bpcMap = new Map(productSizes.map(ps => [ps.id, ps.bottlesPerCase]))

  const computedClosing: { productSizeId: number; totalBottles: number; cases: number; bottles: number }[] = []
  for (const psId of psIdArr) {
    const opening = openingMap.get(psId)?.totalBottles ?? 0
    const receipts = receiptMap.get(psId) ?? 0
    const sold = salesMap.get(psId) ?? 0
    const adj = adjMap.get(psId) ?? 0
    const closingTotal = Math.max(0, opening + receipts + adj - sold)
    if (closingTotal === 0) continue
    const bpc = bpcMap.get(psId) ?? 12
    computedClosing.push({ productSizeId: psId, totalBottles: closingTotal, cases: Math.floor(closingTotal / bpc), bottles: closingTotal % bpc })
  }

  const newSession = await prisma.inventorySession.create({
    data: { periodStart: today, periodEnd: today, staffId },
  })

  for (const entry of computedClosing) {
    await prisma.stockEntry.create({
      data: { sessionId: newSession.id, productSizeId: entry.productSizeId, entryType: 'OPENING', cases: entry.cases, bottles: entry.bottles, totalBottles: entry.totalBottles },
    })
    await prisma.stockEntry.upsert({
      where: { sessionId_productSizeId_entryType: { sessionId: lastSession.id, productSizeId: entry.productSizeId, entryType: 'CLOSING' } },
      create: { sessionId: lastSession.id, productSizeId: entry.productSizeId, entryType: 'CLOSING', cases: entry.cases, bottles: entry.bottles, totalBottles: entry.totalBottles },
      update: { cases: entry.cases, bottles: entry.bottles, totalBottles: entry.totalBottles },
    })
  }

  return NextResponse.json({ success: true, newSessionId: newSession.id, entriesCopied: computedClosing.length })
}
