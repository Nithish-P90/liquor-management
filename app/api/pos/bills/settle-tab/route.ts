import { z } from "zod"
import { requireApiAuth, parseJsonBody, jsonOk, apiError, withApiError } from "@/lib/api/handler"
import { prisma } from "@/lib/platform/prisma"
import { settleTab } from "@/lib/domains/billing/bill"
import { checkBillingPreconditions } from "@/lib/domains/billing/preconditions"
import { zPaymentMode } from "@/lib/platform/zod-schemas"

const zBody = z.object({
  billId: z.number().int().positive(),
  payments: z.array(z.object({ mode: zPaymentMode, amount: z.number().positive(), reference: z.string().optional() })).min(1),
})

export async function POST(req: Request): Promise<Response> {
  const auth = await requireApiAuth("session", req)
  if (auth instanceof Response) return auth

  const body = await parseJsonBody(req, zBody)
  if (body instanceof Response) return body

  const pre = await checkBillingPreconditions()
  if (!pre.ok) return apiError(pre.error, pre.status)

  return withApiError(async () => {
    await prisma.$transaction(
      (tx) => settleTab(tx, { billId: body.billId, actorId: pre.operatorId, payments: body.payments }),
      { timeout: 30000 },
    )
    return jsonOk({ ok: true })
  })
}
