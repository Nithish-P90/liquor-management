import { z } from "zod"

import { requireAdmin } from "@/lib/api-auth"
import { startCountSession, recordCountItems } from "@/lib/physical-count"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

export async function GET(): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  try {
    const sessions = await prisma.physicalCountSession.findMany({
      include: {
        conductedBy: { select: { name: true } },
        items: { include: { productSize: { include: { product: { select: { name: true } } } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    })
    return Response.json(sessions)
  } catch {
    return apiError("Database error", 500)
  }
}

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const body = await req.json()

  // Two modes: "start" or "submit" with items
  if (body.action === "start") {
    try {
      const sessionId = await prisma.$transaction(async (tx) => {
        return startCountSession(tx, parseInt(authResult.id, 10))
      })
      return Response.json({ sessionId }, { status: 201 })
    } catch (err) {
      return apiError(err instanceof Error ? err.message : "Failed", 500)
    }
  }

  const submitSchema = z.object({
    sessionId: z.number().int().positive(),
    items: z.array(z.object({
      productSizeId: z.number().int().positive(),
      countedBottles: z.number().int().nonnegative(),
    })).min(1),
  })

  const parsed = submitSchema.safeParse(body)
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid body")

  try {
    await prisma.$transaction(async (tx) => {
      await recordCountItems(tx, parsed.data.sessionId, parsed.data.items)
    })
    return Response.json({ ok: true })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Failed", 400)
  }
}
