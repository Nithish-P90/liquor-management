import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const id = parseInt(params.id, 10)

  try {
    const indent = await prisma.indent.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            productSize: {
              include: { product: { select: { name: true, category: true } } },
            },
          },
        },
        receipts: { include: { items: true } },
      },
    })
    if (!indent) return apiError("Indent not found", 404)
    return Response.json(indent)
  } catch {
    return apiError("Database error", 500)
  }
}
