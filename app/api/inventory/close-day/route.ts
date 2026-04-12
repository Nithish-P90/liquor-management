import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { normalizeStockEntry } from '@/lib/stock-utils'
import { toUtcNoonDate } from '@/lib/date-utils'

export async function GET() {
  // Returns whether the day can be closed, and current session info
  const today = toUtcNoonDate(new Date())

  const session = await prisma.inventorySession.findFirst({
    orderBy: { periodStart: 'desc' },
    include: { createdBy: { select: { name: true } } },
  })

  const todaySales = await prisma.sale.aggregate({
    where: { saleDate: today },
    _sum: { totalAmount: true, quantityBottles: true },
    _count: { _all: true },
  })

  const hasClosing = session
    ? (await prisma.stockEntry.count({
        where: { sessionId: session.id, entryType: 'CLOSING' },
      })) > 0
    : false

  return NextResponse.json({
    currentSession: session
      ? {
          id: session.id,
          periodStart: session.periodStart,
          periodEnd: session.periodEnd,
          locked: session.locked,
          hasClosing,
        }
      : null,
    todaySales: {
      bills: todaySales._count._all,
      bottles: todaySales._sum.quantityBottles ?? 0,
      totalAmount: Number(todaySales._sum.totalAmount ?? 0),
    },
  })
}

/**
 * POST /api/inventory/close-day
 *
 * Accepts closing stock entries and:
 * 1. Saves closing stock for the current session
 * 2. Runs reconciliation
 * 3. Returns reconciliation results
 *
 * Body: { entries: [{ productSizeId, cases, bottles }] }
 */
export async function POST(req: NextRequest) {
  const auth = await getServerSession(authOptions)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = auth.user as { id?: string; role?: string }
  if (user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const body = await req.json()
  const { entries } = body as {
    entries: { productSizeId: number; cases: number; bottles: number }[]
  }

  // Get or create session for today
  const today = toUtcNoonDate(new Date())
  let session = await prisma.inventorySession.findFirst({
    orderBy: { periodStart: 'desc' },
  })

  if (!session) {
    // Auto-create session from today
    session = await prisma.inventorySession.create({
      data: {
        periodStart: today,
        periodEnd: today,
        staffId: parseInt(user.id ?? '1'),
      },
    })
  }

  // Get all product sizes for normalization
  const allSizes = await prisma.productSize.findMany()
  const sizeMap = new Map(allSizes.map(s => [s.id, s]))

  // Save closing stock entries
  for (const entry of entries) {
    const ps = sizeMap.get(entry.productSizeId)
    if (!ps) continue

    const normalized = normalizeStockEntry(entry.cases, entry.bottles, ps.bottlesPerCase)

    await prisma.stockEntry.upsert({
      where: {
        sessionId_productSizeId_entryType: {
          sessionId: session.id,
          productSizeId: entry.productSizeId,
          entryType: 'CLOSING',
        },
      },
      update: {
        cases: normalized.cases,
        bottles: normalized.bottles,
        totalBottles: normalized.totalBottles,
      },
      create: {
        sessionId: session.id,
        productSizeId: entry.productSizeId,
        entryType: 'CLOSING',
        cases: normalized.cases,
        bottles: normalized.bottles,
        totalBottles: normalized.totalBottles,
      },
    })
  }

  // Also save zero entries for products not included
  for (const ps of allSizes) {
    const hasEntry = entries.some(e => e.productSizeId === ps.id)
    if (!hasEntry) {
      await prisma.stockEntry.upsert({
        where: {
          sessionId_productSizeId_entryType: {
            sessionId: session.id,
            productSizeId: ps.id,
            entryType: 'CLOSING',
          },
        },
        update: {},
        create: {
          sessionId: session.id,
          productSizeId: ps.id,
          entryType: 'CLOSING',
          cases: 0,
          bottles: 0,
          totalBottles: 0,
        },
      })
    }
  }

  // Run reconciliation
  const { runReconciliation } = await import('@/lib/reconciliation')
  const results = await runReconciliation(today, session.id)

  return NextResponse.json({
    sessionId: session.id,
    closingEntriesSaved: entries.length,
    reconciliation: results,
  })
}
