import { MiscCategory } from "@prisma/client"
import { z } from "zod"

import { requireAdmin, requireSession } from "@/lib/api-auth"
import { parseJsonBody, apiError, jsonOk } from "@/lib/api/handler"
import { prisma } from "@/lib/platform/prisma"
import { createMiscItem, listMiscItems } from "@/lib/domains/catalog/misc-items"

const zCategory = z.enum(["CIGARETTES", "SNACKS", "CUPS"])

const itemSchema = z.object({
  name: z.string().trim().min(1),
  category: zCategory,
  unit: z.string().trim().min(1),
  price: z.coerce.number().nonnegative(),
  barcode: z.string().trim().min(1).optional().nullable(),
  active: z.boolean().optional(),
  isThirdParty: z.boolean().optional(),
})

export async function GET(): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  try {
    return jsonOk(await listMiscItems(prisma))
  } catch {
    return apiError("Database error", 500)
  }
}

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const body = await parseJsonBody(req, itemSchema)
  if (body instanceof Response) return body

  try {
    const item = await prisma.$transaction((tx) =>
      createMiscItem(tx, {
        ...body,
        category: body.category as MiscCategory,
      }),
    )

    return jsonOk(item, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return apiError("Barcode already exists", 409)
    }
    return apiError("Database error", 500)
  }
}