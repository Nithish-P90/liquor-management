import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

export async function GET(_req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  try {
    const indents = await prisma.indent.findMany({
      include: {
        items: true,
        receipts: { select: { id: true, receivedDate: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
    return Response.json(indents)
  } catch {
    return apiError("Database error", 500)
  }
}
