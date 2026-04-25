import { z } from "zod"

import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

const bodySchema = z.object({
  indentItemId: z.number().int().positive(),
  productSizeId: z.number().int().positive(),
})

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid body")

  const { indentItemId, productSizeId } = parsed.data
  const indentId = parseInt(params.id, 10)

  try {
    const size = await prisma.productSize.findUnique({
      where: { id: productSizeId },
      select: { productId: true },
    })
    if (!size) return apiError("Product size not found", 404)

    await prisma.indentItem.update({
      where: { id: indentItemId, indentId },
      data: {
        productSizeId,
        productId: size.productId,
        mappingConfidence: 1.0,
        isNewItem: false,
      },
    })

    return Response.json({ ok: true })
  } catch {
    return apiError("Database error", 500)
  }
}
