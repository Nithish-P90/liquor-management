import { z } from "zod"
import { requireApiAuth, parseJsonBody, jsonOk, withApiError } from "@/lib/api/handler"
import { prisma } from "@/lib/platform/prisma"
import { voidBill } from "@/lib/domains/billing/bill"

const zBody = z.object({
  billId: z.number().int().positive(),
  reason: z.string().min(1),
})

export async function POST(req: Request): Promise<Response> {
  const auth = await requireApiAuth("session", req)
  if (auth instanceof Response) return auth

  const body = await parseJsonBody(req, zBody)
  if (body instanceof Response) return body

  return withApiError(async () => {
    const actorId = parseInt(auth.user?.id ?? "0", 10)
    await prisma.$transaction(
      (tx) => voidBill(tx, { billId: body.billId, reason: body.reason, actorId }),
      { timeout: 30000 },
    )
    return jsonOk({ ok: true })
  })
}
