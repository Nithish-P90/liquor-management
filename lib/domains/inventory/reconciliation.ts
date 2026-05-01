import { prisma } from "@/lib/platform/prisma"
import { calculateStock } from "@/lib/domains/inventory/stock"
import { parseDateParam } from "@/lib/platform/dates"
import { DateString } from "@/lib/platform/types"

export type ReconciliationResult = {
  productSizeId: number
  productName: string
  sizeMl: number
  expectedBottles: number
  actualBottles: number
  variance: number
  severity: "OK" | "LOW" | "HIGH"
}

function getSeverity(variance: number): "OK" | "LOW" | "HIGH" {
  if (variance === 0) return "OK"
  if (Math.abs(variance) <= 2) return "LOW"
  return "HIGH"
}

export async function runReconciliation(
  date: DateString,
  sessionId: number,
): Promise<ReconciliationResult[]> {
  const recordDate = parseDateParam(date)

  return prisma.$transaction(async (tx) => {
    const productSizes = await tx.productSize.findMany({
      include: {
        product: {
          select: { name: true },
        },
      },
      orderBy: [{ product: { name: "asc" } }, { sizeMl: "desc" }],
    })

    const closingEntries = await tx.stockEntry.findMany({
      where: { sessionId, entryType: "CLOSING" },
      select: { productSizeId: true, totalBottles: true },
    })

    const closingMap = new Map<number, number>()
    for (const entry of closingEntries) {
      closingMap.set(entry.productSizeId, entry.totalBottles)
    }

    const results: ReconciliationResult[] = []

    for (const size of productSizes) {
      const stock = await calculateStock(tx, size.id, { sessionId, upToDate: date })
      const expectedBottles = stock.totalBottles
      const actualBottles = closingMap.get(size.id) ?? 0
      const variance = actualBottles - expectedBottles
      const severity = getSeverity(variance)

      await tx.varianceRecord.upsert({
        where: {
          recordDate_productSizeId: {
            recordDate,
            productSizeId: size.id,
          },
        },
        update: {
          expectedBottles,
          actualBottles,
          variance,
          severity,
        },
        create: {
          recordDate,
          productSizeId: size.id,
          expectedBottles,
          actualBottles,
          variance,
          severity,
        },
      })

      results.push({
        productSizeId: size.id,
        productName: size.product.name,
        sizeMl: size.sizeMl,
        expectedBottles,
        actualBottles,
        variance,
        severity,
      })
    }

    return results
  })
}
