import { z } from "zod"

import { requireAdmin } from "@/lib/api-auth"
import { parseJsonBody, apiError, jsonOk } from "@/lib/api/handler"
import { prisma } from "@/lib/platform/prisma"
import { updateMiscItem } from "@/lib/domains/catalog/misc-items"

const zCategory = z.enum(["CIGARETTES", "SNACKS", "CUPS"])

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  category: zCategory.optional(),
  unit: z.string().trim().min(1).optional(),
  price: z.coerce.number().nonnegative().optional(),
  barcode: z.string().trim().min(1).optional().nullable(),
  active: z.boolean().optional(),
  isThirdParty: z.boolean().optional(),
})

function parseId(params: { id: string }): number | null {
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) return null
  return id
}

export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const miscItemId = parseId(params)
  if (!miscItemId) return apiError("Invalid misc item id")

  const body = await parseJsonBody(req, patchSchema)
  if (body instanceof Response) return body

  try {
    const item = await prisma.$transaction(async (tx) => {
      const current = await tx.miscItem.findUniqueOrThrow({ where: { id: miscItemId } })
      return updateMiscItem(tx, miscItemId, {
        name: body.name ?? current.name,
        category: body.category ?? current.category,
        unit: body.unit ?? current.unit,
        price: body.price ?? current.price,
        barcode: body.barcode === undefined ? current.barcode : body.barcode,
        active: body.active ?? current.active,
        isThirdParty: body.isThirdParty ?? current.isThirdParty,
      })
    })

    return jsonOk(item)
  } catch {
    return apiError("Database error", 500)
  }
}