import { requireSession } from "@/lib/api-auth"
import { parseDateParam, todayDateString } from "@/lib/platform/dates"
import { getStockSnapshot } from "@/lib/domains/inventory/stock"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

export async function GET(): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  try {
    const today = parseDateParam(todayDateString())
    const session = await prisma.inventorySession.findFirst({
      where: {
        periodStart: { lte: today },
        periodEnd: { gte: today },
        locked: false,
      },
      orderBy: { id: "desc" },
      select: { id: true, periodStart: true },
    })

    const [sizes, miscItems] = await Promise.all([
      prisma.productSize.findMany({
        include: { 
          product: { select: { name: true, category: true, itemCode: true } },
          stockEntries: session ? { where: { sessionId: session.id, entryType: "OPENING" }, select: { totalBottles: true } } : false
        },
        orderBy: [{ product: { name: "asc" } }, { sizeMl: "desc" }],
      }),
      prisma.miscItem.findMany({
        where: { active: true },
        select: { id: true, name: true, unit: true, price: true, category: true, barcode: true },
        orderBy: [{ name: "asc" }],
      }),
    ])

    const stockSnapshot = session
      ? await getStockSnapshot(prisma, { sessionId: session.id, productSizeIds: sizes.map((s) => s.id) })
      : new Map()

    const combined = [
      ...sizes.map((s) => {
        const row = stockSnapshot.get(s.id)
        const stock = row ? Math.max(0, row.totalBottles) : 0
        return {
          kind: "LIQUOR" as const,
          item: s,
          stock,
        }
      }),
      ...miscItems.map((m) => ({ kind: "MISC" as const, item: m, stock: 999 })), // Misc items assumed infinite for now
    ]

    return Response.json(combined)
  } catch (err) {
    console.error("POS Items Error:", err)
    return apiError("Database error", 500)
  }
}
