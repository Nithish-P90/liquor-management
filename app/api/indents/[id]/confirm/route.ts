import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { confirmArrival } from "@/lib/receipts"
import { apiError } from "@/lib/zod-schemas"

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const indentId = parseInt(params.id, 10)
  const actorId = parseInt(authResult.id, 10)

  try {
    await prisma.$transaction(async (tx) => {
      await confirmArrival(tx, indentId, actorId)
    })
    return Response.json({ ok: true })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Confirm failed", 400)
  }
}
