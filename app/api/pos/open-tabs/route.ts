import { requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

export async function GET(_req: Request): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  try {
    const tabs = await prisma.bill.findMany({
      where: { status: "TAB_OPEN" },
      include: {
        lines: {
          where: { isVoidedLine: false },
          include: {
            productSize: { include: { product: { select: { name: true } } } },
            miscItem: { select: { name: true } },
          },
          orderBy: { lineNo: "asc" },
        },
        operator: { select: { name: true } },
        clerk: { select: { name: true } },
      },
      orderBy: { billedAt: "desc" },
      take: 50,
    })

    return Response.json(tabs)
  } catch {
    return apiError("Database error", 500)
  }
}
