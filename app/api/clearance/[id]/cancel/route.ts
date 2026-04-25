import { requireAdmin } from "@/lib/api-auth"
import { cancelClearanceBatch } from "@/lib/clearance"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const batchId = parseInt(params.id, 10)
  const actorId = parseInt(authResult.id, 10)

  try {
    await prisma.$transaction(async (tx) => {
      await cancelClearanceBatch(tx, batchId, actorId)
    })
    return Response.json({ ok: true })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Cancel failed", 400)
  }
}
