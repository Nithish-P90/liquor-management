import { z } from "zod"

import { requireAdmin, requireSession } from "@/lib/api-auth"
import { createClearanceBatch } from "@/lib/clearance"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

export async function GET(): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  try {
    const batches = await prisma.clearanceBatch.findMany({
      include: {
        productSize: { include: { product: { select: { name: true, category: true } } } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
    return Response.json(batches)
  } catch {
    return apiError("Database error", 500)
  }
}

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const parsed = z.object({
    productSizeId: z.number().int().positive(),
    clearanceRate: z.number().positive(),
    totalQuantity: z.number().int().positive(),
    reason: z.string().trim().optional(),
  }).safeParse(await req.json())

  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid body")

  try {
    const batchId = await prisma.$transaction(async (tx) => {
      return createClearanceBatch(tx, {
        ...parsed.data,
        createdById: parseInt(authResult.id, 10),
      })
    })
    return Response.json({ id: batchId }, { status: 201 })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Create failed", 400)
  }
}
