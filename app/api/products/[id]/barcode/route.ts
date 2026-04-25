import { z } from "zod"

import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

const bodySchema = z.object({
  sizeId: z.number().int().positive(),
  barcode: z.string().trim().min(1),
})

export async function PATCH(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid body")
  }

  try {
    const updated = await prisma.productSize.update({
      where: { id: parsed.data.sizeId },
      data: { barcode: parsed.data.barcode },
    })

    return Response.json(updated)
  } catch {
    return apiError("Database error", 500)
  }
}
