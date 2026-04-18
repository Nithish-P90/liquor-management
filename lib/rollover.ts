import prisma from '@/lib/prisma'
import { StockEntryType } from '@prisma/client'
import { toUtcNoonDate } from '@/lib/date-utils'
import { getCurrentStock } from '@/lib/reconciliation'

export type EnsureDailyRolloverResult = {
  status: 'up_to_date' | 'rolled_over' | 'no_history'
  sessionId?: number
  entriesCopied?: number
  msg: string
}

/**
 * Ensures today's inventory session exists with OPENING entries.
 * This makes rollover event-driven (on normal API usage), removing hard dependency on external schedulers.
 */
export async function ensureDailyRollover(): Promise<EnsureDailyRolloverResult> {
  const today = toUtcNoonDate(new Date())

  const sessionToday = await prisma.inventorySession.findFirst({
    where: { periodEnd: { equals: today } },
    select: { id: true },
  })

  if (sessionToday) {
    const hasOpening = await prisma.stockEntry.findFirst({
      where: { sessionId: sessionToday.id, entryType: StockEntryType.OPENING },
      select: { id: true },
    })

    if (hasOpening) {
      return { status: 'up_to_date', sessionId: sessionToday.id, msg: 'Session already active.' }
    }
  }

  const activePastSession = await prisma.inventorySession.findFirst({
    where: { periodEnd: { lt: today } },
    orderBy: { periodEnd: 'desc' },
    include: { stockEntries: true },
  })

  if (!activePastSession) {
    return { status: 'no_history', msg: 'No past session found to roll over from.' }
  }

  const hasClosing = activePastSession.stockEntries.some((entry) => entry.entryType === StockEntryType.CLOSING)

  // If previous day was left without closing, compute and backfill it once.
  if (!hasClosing) {
    const productSizes = await prisma.productSize.findMany({
      select: { id: true, bottlesPerCase: true },
    })

    for (const ps of productSizes) {
      const expectedStock = await getCurrentStock(ps.id, activePastSession.id)
      await prisma.stockEntry.upsert({
        where: {
          sessionId_productSizeId_entryType: {
            sessionId: activePastSession.id,
            productSizeId: ps.id,
            entryType: StockEntryType.CLOSING,
          },
        },
        create: {
          sessionId: activePastSession.id,
          productSizeId: ps.id,
          entryType: StockEntryType.CLOSING,
          cases: Math.floor(expectedStock / ps.bottlesPerCase),
          bottles: expectedStock % ps.bottlesPerCase,
          totalBottles: expectedStock,
        },
        update: {
          cases: Math.floor(expectedStock / ps.bottlesPerCase),
          bottles: expectedStock % ps.bottlesPerCase,
          totalBottles: expectedStock,
        },
      })
    }
  }

  const closingEntries = await prisma.stockEntry.findMany({
    where: {
      sessionId: activePastSession.id,
      entryType: StockEntryType.CLOSING,
    },
    select: {
      productSizeId: true,
      cases: true,
      bottles: true,
      totalBottles: true,
    },
  })

  let newSessionId = sessionToday?.id
  if (!newSessionId) {
    const created = await prisma.inventorySession.create({
      data: {
        periodStart: today,
        periodEnd: today,
        staffId: 1,
      },
      select: { id: true },
    })
    newSessionId = created.id
  }

  if (closingEntries.length > 0) {
    await prisma.stockEntry.createMany({
      data: closingEntries.map((closing) => ({
        sessionId: newSessionId!,
        productSizeId: closing.productSizeId,
        entryType: StockEntryType.OPENING,
        cases: closing.cases,
        bottles: closing.bottles,
        totalBottles: closing.totalBottles,
      })),
      skipDuplicates: true,
    })
  }

  return {
    status: 'rolled_over',
    sessionId: newSessionId,
    entriesCopied: closingEntries.length,
    msg: `Rolled over ${closingEntries.length} items to ${today.toISOString().split('T')[0]}.`,
  }
}
