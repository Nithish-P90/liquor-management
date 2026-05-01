import { requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

export async function GET(
  _req: Request,
  { params }: { params: { code: string } },
): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  const { code } = params

  try {
    const size = await prisma.productSize.findFirst({
      where: {
        OR: [{ barcode: code }, { alternateBarcodes: { has: code } }],
      },
      include: {
        product: { select: { name: true, category: true, itemCode: true } },
      },
    })

    if (size) return Response.json({ kind: "LIQUOR", item: size })

    const misc = await prisma.miscItem.findFirst({
      where: { barcode: code, active: true },
      select: { id: true, name: true, unit: true, price: true, category: true, barcode: true },
    })

    if (!misc) return apiError("Barcode not found", 404)
    return Response.json({ kind: "MISC", item: misc })
  } catch {
    return apiError("Database error", 500)
  }
}
