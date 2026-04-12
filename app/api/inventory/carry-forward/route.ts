import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'

/**
 * POST /api/inventory/carry-forward
 *
 * Auto-creates a new session and copies the previous session's closing stock
 * as the new session's opening stock. This eliminates manual re-entry.
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

  // Find the last session with closing entries
  const lastSession = await prisma.inventorySession.findFirst({
    orderBy: { periodEnd: 'desc' },
    include: {
      stockEntries: {
        where: { entryType: 'CLOSING' },
      },
    },
  })

  if (!lastSession || lastSession.stockEntries.length === 0) {
    return NextResponse.json(
      { error: 'No previous closing stock found. Please enter opening stock manually.' },
      { status: 400 }
    )
  }

  // Create new session
  const newSession = await prisma.inventorySession.create({
    data: {
      periodStart,
      periodEnd,
      staffId: parseInt(user.id ?? '1'),
    },
  })

  // Copy closing → opening
  let copiedCount = 0
  for (const closing of lastSession.stockEntries) {
    if (closing.totalBottles === 0 && closing.cases === 0 && closing.bottles === 0) continue

    await prisma.stockEntry.create({
      data: {
        sessionId: newSession.id,
        productSizeId: closing.productSizeId,
        entryType: 'OPENING',
        cases: closing.cases,
        bottles: closing.bottles,
        totalBottles: closing.totalBottles,
      },
    })
    copiedCount++
  }

  return NextResponse.json({
    newSessionId: newSession.id,
    copiedFromSessionId: lastSession.id,
    entriesCopied: copiedCount,
    periodStart: newSession.periodStart,
    periodEnd: newSession.periodEnd,
  })
}
