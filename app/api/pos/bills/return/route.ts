import { z } from "zod"
import { requireApiAuth, parseJsonBody, jsonOk, apiError, withApiError } from "@/lib/api/handler"
import { prisma } from "@/lib/platform/prisma"
import { commitReturn } from "@/lib/domains/billing/bill"
import { checkBillingPreconditions } from "@/lib/domains/billing/preconditions"

const zBody = z.object({
  clerkId: z.number().int().positive(),
  reason: z.string().min(1),
  lines: z.array(z.object({
    productSizeId: z.number().int().positive().optional(),
    miscItemId: z.number().int().positive().optional(),
    itemNameSnapshot: z.string().min(1),
    quantity: z.number().int().positive(),
    unitPrice: z.number().positive(),
  })).min(1),
})

export async function POST(req: Request): Promise<Response> {
  const auth = await requireApiAuth("session", req)
  if (auth instanceof Response) return auth

  const body = await parseJsonBody(req, zBody)
  if (body instanceof Response) return body

  const pre = await checkBillingPreconditions()
  if (!pre.ok) return apiError(pre.error, pre.status)

  return withApiError(async () => {
    const result = await prisma.$transaction(
      (tx) => commitReturn(tx, { ...body, operatorId: pre.operatorId }),
      { timeout: 30000 },
    )
    return jsonOk(result, { status: 201 })
  })
}
