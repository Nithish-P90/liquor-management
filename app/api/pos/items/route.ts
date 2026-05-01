import { requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

export async function GET(): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  try {
    const [sizes, miscItems] = await Promise.all([
      prisma.productSize.findMany({
        include: { product: { select: { name: true, category: true, itemCode: true } } },
        orderBy: [{ product: { name: "asc" } }, { sizeMl: "desc" }],
      }),
      prisma.miscItem.findMany({
        where: { active: true },
        select: { id: true, name: true, unit: true, price: true, category: true, barcode: true },
        orderBy: [{ name: "asc" }],
      }),
    ])

    const combined = [
      ...sizes.map((s) => ({ kind: "LIQUOR" as const, item: s })),
      ...miscItems.map((m) => ({ kind: "MISC" as const, item: m })),
    ]

    return Response.json(combined)
  } catch {
    return apiError("Database error", 500)
  }
}
