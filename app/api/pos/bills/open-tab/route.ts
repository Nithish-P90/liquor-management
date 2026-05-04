import { z } from "zod"
import { requireApiAuth, parseJsonBody, jsonOk, apiError, withApiError } from "@/lib/api/handler"
import { prisma } from "@/lib/platform/prisma"
import { openTab } from "@/lib/domains/billing/bill"
import { checkBillingPreconditions } from "@/lib/domains/billing/preconditions"
import { zScanMethod } from "@/lib/platform/zod-schemas"

const zLine = z.object({
  productSizeId: z.number().int().positive().optional(),
  miscItemId: z.number().int().positive().optional(),
  itemNameSnapshot: z.string().min(1),
  barcodeSnapshot: z.string().optional(),
  quantity: z.number().int().positive(),
  scanMethod: zScanMethod.optional(),
  isManualOverride: z.boolean().optional(),
  overrideReason: z.string().optional(),
})

const zBody = z.object({
  attributionType: z.enum(["COUNTER", "CLERK"]).optional(),
  clerkId: z.number().int().positive().optional(),
  customerName: z.string().optional(),
  notes: z.string().optional(),
  lines: z.array(zLine).min(1),
  existingBillId: z.number().int().positive().optional(),
})

export async function POST(req: Request): Promise<Response> {
  const auth = await requireApiAuth("session", req)
  if (auth instanceof Response) return auth

  const body = await parseJsonBody(req, zBody)
  if (body instanceof Response) return body

  const pre = await checkBillingPreconditions()
  if (!pre.ok) return apiError(pre.error, pre.status)

  return withApiError(async () => {
    const billId = await prisma.$transaction(
      (tx) => openTab(tx, { ...body, operatorId: pre.operatorId }),
      { timeout: 30000 },
    )
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId }, select: { billNumber: true } })
    return jsonOk({ billId, billNumber: bill.billNumber }, { status: 201 })
  })
}
