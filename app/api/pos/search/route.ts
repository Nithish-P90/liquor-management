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
    const sizes = await prisma.productSize.findMany({
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
      take: limit,
      orderBy: [{ product: { name: "asc" } }, { sizeMl: "desc" }],
    })

    return Response.json(sizes)
  } catch {
    return apiError("Database error", 500)
  }
}
