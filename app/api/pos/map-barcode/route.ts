import { z } from "zod"

import { requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

const bodySchema = z.object({
  kind: z.enum(["LIQUOR", "MISC"]),
  id: z.number().int().positive(),
  barcode: z.string().trim().min(1),
})

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid body")

  const { kind, id, barcode } = parsed.data

  try {
    const [existingLiquor, existingMisc] = await Promise.all([
      prisma.productSize.findFirst({
        where: { OR: [{ barcode }, { alternateBarcodes: { has: barcode } }] },
        select: { id: true },
      }),
      prisma.miscItem.findFirst({
        where: { barcode },
        select: { id: true },
      }),
    ])

    if (kind === "LIQUOR") {
      if ((existingLiquor && existingLiquor.id !== id) || existingMisc) {
        return apiError("Barcode already assigned to another item", 409)
      }

      const size = await prisma.productSize.findUnique({
        where: { id },
        select: { barcode: true, alternateBarcodes: true },
      })
      if (!size) return apiError("Product size not found", 404)

      if (!size.barcode) {
        await prisma.productSize.update({
          where: { id },
          data: { barcode },
        })
      } else if (!size.alternateBarcodes.includes(barcode)) {
        await prisma.productSize.update({
          where: { id },
          data: { alternateBarcodes: { push: barcode } },
        })
      }
    } else {
      // MISC
      if (existingLiquor || (existingMisc && existingMisc.id !== id)) {
        return apiError("Barcode already assigned to another item", 409)
      }

      const misc = await prisma.miscItem.findUnique({
        where: { id },
        select: { id: true },
      })
      if (!misc) return apiError("Misc item not found", 404)

      await prisma.miscItem.update({
        where: { id },
        data: { barcode },
      })
    }

    return Response.json({ ok: true })
  } catch {
    return apiError("Database error", 500)
  }
}
