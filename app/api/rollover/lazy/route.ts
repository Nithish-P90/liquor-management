export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'
import { getCurrentStock } from '@/lib/reconciliation'

export async function POST() {
  try {
    const today = toUtcNoonDate(new Date())

    // 1. Check if an active session exists for TODAY
    const sessionToday = await prisma.inventorySession.findFirst({
      where: { periodEnd: { equals: today } },
      include: { stockEntries: true }
    })

    // If today's session is already spawned and has an opening stock, we are fully up to date.
    if (sessionToday && sessionToday.stockEntries.some((e: any) => e.entryType === 'OPENING')) {
      return NextResponse.json({ status: 'up_to_date', msg: 'Session already active.' })
    }

    // 2. We need to roll over. Find the most recent strictly past session (where periodEnd < today)
    const activePastSession = await prisma.inventorySession.findFirst({
      where: { periodEnd: { lt: today } },
      orderBy: { periodEnd: 'desc' },
      include: { stockEntries: true }
    })

    // If completely empty system
    if (!activePastSession) {
      return NextResponse.json({ status: 'no_history', msg: 'No past session found to roll over from.' })
    }

    const hasClosing = activePastSession.stockEntries.some((e: any) => e.entryType === 'CLOSING')

    // 3. ZERO-CLICK DAILY AUTO-CLOSE (Resolve Yesterday's missing closing stock mathematically)
    if (!hasClosing) {
      const productSizes = await prisma.productSize.findMany()
      for (const ps of productSizes) {
        // Evaluate expected mathematical stock
        const expectedStock = await getCurrentStock(ps.id, activePastSession.id)
        
        await prisma.stockEntry.create({
          data: {
            sessionId: activePastSession.id,
            productSizeId: ps.id,
            entryType: 'CLOSING',
            cases: Math.floor(expectedStock / ps.bottlesPerCase),
            bottles: expectedStock % ps.bottlesPerCase,
            totalBottles: expectedStock,
          }
        })
      }
    }

    // 4. PREPARE TODAY'S SESSION (Auto Carry Forward)
    // We get the closing entries now (either they existed or we just mathematically generated them)
    const closingEntries = await prisma.stockEntry.findMany({
      where: { sessionId: activePastSession.id, entryType: 'CLOSING' }
    })

    // If today's session wrapper somehow got created without entries, use it, else create
    const newSessionId = sessionToday?.id ?? (await prisma.inventorySession.create({
      data: {
        periodStart: today,
        periodEnd: today,
        staffId: 1 // Default System Rollover Staff
      }
    })).id

    // Map Closing to Opening
    for (const closing of closingEntries) {
      if (closing.totalBottles === 0) continue

      await prisma.stockEntry.create({
        data: {
          sessionId: newSessionId,
          productSizeId: closing.productSizeId,
          entryType: 'OPENING',
          cases: closing.cases,
          bottles: closing.bottles,
          totalBottles: closing.totalBottles,
        }
      })
    }

    return NextResponse.json({ 
      status: 'rolled_over', 
      msg: `Rolled over ${closingEntries.length} items to ${today.toISOString().split('T')[0]}.`
    })

  } catch (error: any) {
    console.error("[Lazy Rollover Error]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
