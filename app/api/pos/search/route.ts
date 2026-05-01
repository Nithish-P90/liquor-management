import { z } from "zod"

import { requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

const querySchema = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
})

export async function GET(req: Request): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  const url = new URL(req.url)
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid query")

  const { q, limit } = parsed.data

  try {
    const sizeLimit = Math.min(limit, 20)
    const miscLimit = Math.min(limit, 20)

    const [sizes, miscItems] = await Promise.all([
      prisma.productSize.findMany({
      where: {
        OR: [
          { product: { name: { contains: q, mode: "insensitive" } } },
          { product: { itemCode: { contains: q, mode: "insensitive" } } },
          { barcode: { contains: q } },
          { ksbclItemCode: { contains: q } },
        ],
      },
      include: {
        product: { select: { name: true, category: true, itemCode: true } },
      },
      take: sizeLimit,
      orderBy: [{ product: { name: "asc" } }, { sizeMl: "desc" }],
    }),
      prisma.miscItem.findMany({
        where: {
          active: true,
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { barcode: { contains: q } },
          ],
        },
        select: { id: true, name: true, unit: true, price: true, category: true, barcode: true },
        take: miscLimit,
        orderBy: [{ name: "asc" }],
      }),
    ])

    const combined = [
      ...sizes.map((s) => ({ kind: "LIQUOR" as const, item: s })),
      ...miscItems.map((m) => ({ kind: "MISC" as const, item: m })),
    ]

    return Response.json(combined.slice(0, limit))
  } catch {
    return apiError("Database error", 500)
  }
}
