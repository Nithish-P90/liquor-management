import { z } from "zod"
import { requireApiAuth, parseJsonBody, jsonOk, withApiError } from "@/lib/api/handler"
import { prisma } from "@/lib/platform/prisma"
import { computeCart } from "@/lib/domains/billing/compute"

const zLine = z.object({
  kind: z.enum(["LIQUOR", "MISC"]),
  productSizeId: z.number().int().positive().optional(),
  miscItemId: z.number().int().positive().optional(),
  quantity: z.number().int().positive(),
})

const zBody = z.object({ lines: z.array(zLine).min(1) })

export async function POST(req: Request): Promise<Response> {
  const auth = await requireApiAuth("session", req)
  if (auth instanceof Response) return auth

  const body = await parseJsonBody(req, zBody)
  if (body instanceof Response) return body

  return withApiError(async () => {
    const result = await prisma.$transaction((tx) => computeCart(tx, body), { timeout: 15000 })
    return jsonOk(result)
  })
}
