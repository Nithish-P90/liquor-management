import { prisma } from "@/lib/platform/prisma"
import { calculateStock, splitStock } from "@/lib/domains/inventory/stock"
import { addDays, parseDateParam, subtractDays, todayDateString } from "@/lib/platform/dates"

export type RolloverStatus = "up_to_date" | "rolled_over" | "no_history"

export async function ensureDailyRollover(): Promise<RolloverStatus> {
  const today = todayDateString()
  const todayDate = parseDateParam(today)

  const existing = await prisma.inventorySession.findFirst({
    where: { periodStart: todayDate },
    select: { id: true },
  })

  if (existing) {
    return "up_to_date"
  }

  const yesterdayDate = parseDateParam(subtractDays(today, 1))
  const dayAfterToday = parseDateParam(addDays(today, 1))

  const previousSession = await prisma.inventorySession.findFirst({
    where: { periodStart: { lt: todayDate } },
    orderBy: [{ periodStart: "desc" }, { id: "desc" }],
    select: {
      id: true,
      staffId: true,
      periodStart: true,
      periodEnd: true,
    },
  })

  if (!previousSession) {
    return "no_history"
  }

  return prisma.$transaction(async (tx): Promise<RolloverStatus> => {
    let closingRows = await tx.stockEntry.findMany({
      where: {
        sessionId: previousSession.id,
        entryType: "CLOSING",
      },
    })

    if (closingRows.length === 0) {
      const allSizes = await tx.productSize.findMany({
        select: {
          id: true,
          bottlesPerCase: true,
        },
      })

      for (const size of allSizes) {
        const stock = await calculateStock(tx, size.id, {
          sessionId: previousSession.id,
          upToDate: subtractDays(today, 1),
        })

        const normalized = splitStock(stock.totalBottles, size.bottlesPerCase)

        await tx.stockEntry.upsert({
          where: {
            sessionId_productSizeId_entryType: {
              sessionId: previousSession.id,
              productSizeId: size.id,
              entryType: "CLOSING",
            },
          },
          update: {
            cases: normalized.cases,
            bottles: normalized.bottles,
            totalBottles: stock.totalBottles,
          },
          create: {
            sessionId: previousSession.id,
            productSizeId: size.id,
            entryType: "CLOSING",
            cases: normalized.cases,
            bottles: normalized.bottles,
            totalBottles: stock.totalBottles,
          },
        })
      }

      closingRows = await tx.stockEntry.findMany({
        where: {
          sessionId: previousSession.id,
          entryType: "CLOSING",
        },
      })
    }

    const newSession = await tx.inventorySession.create({
      data: {
        periodStart: todayDate,
        periodEnd: dayAfterToday,
        staffId: previousSession.staffId,
      },
      select: { id: true },
    })

    if (closingRows.length > 0) {
      await tx.stockEntry.createMany({
        data: closingRows.map((row) => ({
          sessionId: newSession.id,
          productSizeId: row.productSizeId,
          entryType: "OPENING",
          cases: row.cases,
          bottles: row.bottles,
          totalBottles: row.totalBottles,
        })),
      })
    }

    await tx.inventorySession.update({
      where: { id: previousSession.id },
      data: {
        periodEnd: yesterdayDate,
      },
    })

    return "rolled_over"
  })
}
