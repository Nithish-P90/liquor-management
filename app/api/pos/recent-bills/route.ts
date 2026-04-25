import { z } from "zod"

import { requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
})

export async function GET(req: Request): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  const url = new URL(req.url)
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams))
  const limit = parsed.success ? parsed.data.limit : 20

  try {
    const bills = await prisma.bill.findMany({
      where: { status: { in: ["COMMITTED", "VOIDED"] } },
      include: {
        operator: { select: { name: true } },
        clerk: { select: { name: true } },
        payments: true,
        lines: {
          where: { isVoidedLine: false },
          include: {
            productSize: { include: { product: { select: { name: true } } } },
            miscItem: { select: { name: true } },
          },
          orderBy: { lineNo: "asc" },
        },
      },
      orderBy: { billedAt: "desc" },
      take: limit,
    })

    return Response.json(bills)
  } catch {
    return apiError("Database error", 500)
  }
}
