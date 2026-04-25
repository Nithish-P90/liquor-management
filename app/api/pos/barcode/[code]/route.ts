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

    if (!size) return apiError("Barcode not found", 404)
    return Response.json(size)
  } catch {
    return apiError("Database error", 500)
  }
}
