import { z } from "zod"

import { requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

const bodySchema = z.object({
  productSizeId: z.number().int().positive(),
  barcode: z.string().trim().min(1),
})

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid body")

  const { productSizeId, barcode } = parsed.data

  try {
    const existing = await prisma.productSize.findFirst({
      where: { OR: [{ barcode }, { alternateBarcodes: { has: barcode } }] },
      select: { id: true },
    })
    if (existing && existing.id !== productSizeId) {
      return apiError("Barcode already assigned to another product", 409)
    }

    const size = await prisma.productSize.findUnique({
      where: { id: productSizeId },
      select: { barcode: true, alternateBarcodes: true },
    })
    if (!size) return apiError("Product size not found", 404)

    if (!size.barcode) {
      await prisma.productSize.update({
        where: { id: productSizeId },
        data: { barcode },
      })
    } else if (!size.alternateBarcodes.includes(barcode)) {
      await prisma.productSize.update({
        where: { id: productSizeId },
        data: { alternateBarcodes: { push: barcode } },
      })
    }

    return Response.json({ ok: true })
  } catch {
    return apiError("Database error", 500)
  }
}
