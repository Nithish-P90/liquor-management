import { parseDateParam, todayDateString, addDays } from "@/lib/platform/dates"
import { prisma } from "@/lib/platform/prisma"
import { normalizeStockEntry } from "@/lib/domains/inventory/stock"

export type SetInitialOpeningStockParams = {
  staffId: number
  items: Array<{
    productSizeId: number
    cases: number
    bottles: number
  }>
}

export async function setInitialOpeningStock(
  params: SetInitialOpeningStockParams,
): Promise<{ sessionId: number; itemCount: number }> {
  const businessDate = todayDateString()
  const dateObj = parseDateParam(businessDate)

  return prisma.$transaction(async (tx) => {
    // Guard: ensure no session already exists (prevent overwriting)
    const existingSession = await tx.inventorySession.findFirst({
      where: { periodStart: dateObj },
      select: { id: true },
    })
    if (existingSession) {
      throw new Error("Inventory session already exists for today. Cannot set initial stock.")
    }

    // Create session for today
    const tomorrow = addDays(businessDate, 1)
    const tomorrowDate = parseDateParam(tomorrow)

    const session = await tx.inventorySession.create({
      data: {
        periodStart: dateObj,
        periodEnd: tomorrowDate,
        staffId: params.staffId,
      },
      select: { id: true },
    })

    // Fetch product sizes to get bottlesPerCase for each
    const productSizes = await tx.productSize.findMany({
      where: { id: { in: params.items.map((i) => i.productSizeId) } },
      select: { id: true, bottlesPerCase: true },
    })

    const sizeMap = new Map(productSizes.map((ps) => [ps.id, ps]))

    // Write OPENING entries
    for (const item of params.items) {
      const ps = sizeMap.get(item.productSizeId)
      if (!ps) {
        throw new Error(`ProductSize ${item.productSizeId} not found`)
      }

      const normalized = normalizeStockEntry(item.cases, item.bottles, ps.bottlesPerCase)

      await tx.stockEntry.create({
        data: {
          sessionId: session.id,
          productSizeId: item.productSizeId,
          entryType: "OPENING",
          cases: normalized.cases,
          bottles: normalized.bottles,
          totalBottles: normalized.totalBottles,
        },
      })
    }

    return { sessionId: session.id, itemCount: params.items.length }
  }, { timeout: 30000 })
}
