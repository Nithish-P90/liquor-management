import { z } from "zod"

import { requireApiAuth, parseJsonBody, jsonOk, apiError } from "@/lib/api/handler"
import { prisma } from "@/lib/platform/prisma"
import { todayDateString, parseDateParam } from "@/lib/platform/dates"

const bodySchema = z.object({
  productSizeId: z.number().int().positive(),
  quantityBottles: z.number().int().refine((n) => n !== 0, "Quantity cannot be zero"),
  reason: z.string().trim().min(1),
})

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireApiAuth("admin", req)
  if (authResult instanceof Response) return authResult

  const staffId = Number(authResult.user?.id)
  if (!staffId || isNaN(staffId)) return apiError("Invalid session", 401)

  const bodyOrError = await parseJsonBody(req, bodySchema)
  if (bodyOrError instanceof Response) return bodyOrError

  const { productSizeId, quantityBottles, reason } = bodyOrError

  try {
    const size = await prisma.productSize.findUnique({
      where: { id: productSizeId },
      select: { id: true },
    })
    if (!size) return apiError("Product size not found", 404)

    const adjustment = await prisma.stockAdjustment.create({
      data: {
        productSizeId,
        adjustmentType: "CORRECTION",
        quantityBottles,
        reason,
        adjustmentDate: parseDateParam(todayDateString()),
        createdById: staffId,
        approvedById: staffId,
        approved: true,
      },
    })

    return jsonOk(adjustment, { status: 201 })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Adjustment failed", 500)
  }
}
