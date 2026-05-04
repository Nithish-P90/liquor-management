import { z } from "zod"
import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/platform/prisma"
import { runEndOfDay } from "@/lib/domains/inventory/eod"
import { parseDateParam, subtractDays, addDays, todayDateString } from "@/lib/platform/dates"
import type { DateString } from "@/lib/platform/types"
import { calculateStock, splitStock } from "@/lib/domains/inventory/stock"

const zForward = z.object({
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "toDate must be YYYY-MM-DD"),
})

// POST — roll forward: run EOD for (toDate - 1), create session for toDate
export async function POST(req: Request): Promise<Response> {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const body = await req.json().catch(() => ({}))
  const parsed = zForward.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 })

  const toDate = parsed.data.toDate as DateString
  const toDateObj = parseDateParam(toDate)
  const fromDate = subtractDays(toDate, 1)
  const fromDateObj = parseDateParam(fromDate)
  const dayAfterTo = parseDateParam(addDays(toDate, 1))

  // Block rolling to a future date beyond tomorrow
  const tomorrow = addDays(todayDateString(), 1)
  if (toDate > tomorrow) {
    return Response.json({ error: "Cannot roll more than one day ahead of today" }, { status: 400 })
  }

  try {
    // 1. Run EOD for fromDate if not already closed
    const prevGallaDay = await prisma.gallaDay.findUnique({
      where: { businessDate: fromDateObj },
      select: { isClosed: true },
    })
    let eodRan = false
    if (!prevGallaDay?.isClosed) {
      await runEndOfDay(fromDate)
      eodRan = true
    }

    // 2. Check if toDate session already exists
    const existingSession = await prisma.inventorySession.findFirst({
      where: { periodStart: toDateObj },
      select: { id: true },
    })
    if (existingSession) {
      return Response.json({ ok: true, eodRan, sessionCreated: false, message: `Session for ${toDate} already exists` })
    }

    // 3. Get previous session closing rows
    const prevSession = await prisma.inventorySession.findFirst({
      where: { periodStart: { lt: toDateObj } },
      orderBy: [{ periodStart: "desc" }, { id: "desc" }],
    })
    if (!prevSession) {
      return Response.json({ error: "No previous session found to roll from" }, { status: 409 })
    }

    let closingRows = await prisma.stockEntry.findMany({
      where: { sessionId: prevSession.id, entryType: "CLOSING" },
    })

    // If EOD didn't write closing rows (e.g., no galla day), compute them now
    if (closingRows.length === 0) {
      const sizes = await prisma.productSize.findMany({ select: { id: true, bottlesPerCase: true } })
      for (const size of sizes) {
        const stock = await calculateStock(prisma as never, size.id, { sessionId: prevSession.id, upToDate: fromDate })
        const normalized = splitStock(stock.totalBottles, size.bottlesPerCase)
        await prisma.stockEntry.upsert({
          where: { sessionId_productSizeId_entryType: { sessionId: prevSession.id, productSizeId: size.id, entryType: "CLOSING" } },
          update: { cases: normalized.cases, bottles: normalized.bottles, totalBottles: stock.totalBottles },
          create: { sessionId: prevSession.id, productSizeId: size.id, entryType: "CLOSING", cases: normalized.cases, bottles: normalized.bottles, totalBottles: stock.totalBottles },
        })
      }
      closingRows = await prisma.stockEntry.findMany({ where: { sessionId: prevSession.id, entryType: "CLOSING" } })
    }

    // 4. Create new session for toDate
    await prisma.$transaction(async (tx) => {
      const newSession = await tx.inventorySession.create({
        data: { periodStart: toDateObj, periodEnd: dayAfterTo, staffId: prevSession.staffId },
        select: { id: true },
      })
      if (closingRows.length > 0) {
        await tx.stockEntry.createMany({
          data: closingRows.map((r) => ({
            sessionId: newSession.id,
            productSizeId: r.productSizeId,
            entryType: "OPENING",
            cases: r.cases,
            bottles: r.bottles,
            totalBottles: r.totalBottles,
          })),
        })
      }
      await tx.inventorySession.update({ where: { id: prevSession.id }, data: { periodEnd: fromDateObj } })
    }, { timeout: 60000 })

    return Response.json({ ok: true, eodRan, sessionCreated: true, toDate })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Force rollover failed" }, { status: 500 })
  }
}

// DELETE — roll backward: undo today's session (only if no bills exist for that date)
export async function DELETE(req: Request): Promise<Response> {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const url = new URL(req.url)
  const dateParam = (url.searchParams.get("date") ?? todayDateString()) as DateString
  const dateObj = parseDateParam(dateParam)

  try {
    // Safety: refuse if any bills exist for this date
    const billCount = await prisma.bill.count({ where: { businessDate: dateObj } })
    if (billCount > 0) {
      return Response.json({ error: `Cannot roll back — ${billCount} bill(s) exist for ${dateParam}. Delete them first.` }, { status: 409 })
    }

    const session = await prisma.inventorySession.findFirst({ where: { periodStart: dateObj } })
    if (!session) {
      return Response.json({ error: `No session found for ${dateParam}` }, { status: 404 })
    }

    await prisma.$transaction(async (tx) => {
      // Delete opening stock entries for this session
      await tx.stockEntry.deleteMany({ where: { sessionId: session.id, entryType: "OPENING" } })
      // Delete the session
      await tx.inventorySession.delete({ where: { id: session.id } })
      // Reopen the previous galla day
      const prevDateObj = parseDateParam(subtractDays(dateParam as DateString, 1))
      await tx.gallaDay.updateMany({
        where: { businessDate: prevDateObj, isClosed: true },
        data: { isClosed: false, closedAt: null, closedById: null, closingBalance: "0", countedAmount: null, variance: null },
      })
    })

    return Response.json({ ok: true, rolledBackTo: subtractDays(dateParam, 1) })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Roll back failed" }, { status: 500 })
  }
}
