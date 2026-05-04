import { z } from "zod"

import { requireApiAuth, parseJsonBody, jsonOk, apiError } from "@/lib/api/handler"
import { prisma } from "@/lib/platform/prisma"
import { normalizeStockEntry } from "@/lib/domains/inventory/stock"

const bodySchema = z.object({
  cases: z.number().int().nonnegative(),
  bottles: z.number().int().nonnegative(),
})

export async function PUT(
  req: Request,
  { params }: { params: { sizeId: string } },
): Promise<Response> {
  const authResult = await requireApiAuth("admin", req)
  if (authResult instanceof Response) return authResult

  const productSizeId = Number(params.sizeId)
  if (!Number.isInteger(productSizeId) || productSizeId <= 0) return apiError("Invalid sizeId")

  const bodyOrError = await parseJsonBody(req, bodySchema)
  if (bodyOrError instanceof Response) return bodyOrError

  const { cases, bottles } = bodyOrError

  try {
    const session = await prisma.inventorySession.findFirst({
      where: { locked: false },
      orderBy: { id: "desc" },
      select: { id: true },
    })
    if (!session) return apiError("No active inventory session", 409)

    const size = await prisma.productSize.findUnique({
      where: { id: productSizeId },
      select: { bottlesPerCase: true },
    })
    if (!size) return apiError("Product size not found", 404)

    const normalized = normalizeStockEntry(cases, bottles, size.bottlesPerCase)

    await prisma.stockEntry.upsert({
      where: {
        sessionId_productSizeId_entryType: {
          sessionId: session.id,
          productSizeId,
          entryType: "OPENING",
        },
      },
      update: {
        cases: normalized.cases,
        bottles: normalized.bottles,
        totalBottles: normalized.totalBottles,
      },
      create: {
        sessionId: session.id,
        productSizeId,
        entryType: "OPENING",
        cases: normalized.cases,
        bottles: normalized.bottles,
        totalBottles: normalized.totalBottles,
      },
    })

    return jsonOk({ sessionId: session.id, productSizeId, ...normalized })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Update failed", 500)
  }
}
