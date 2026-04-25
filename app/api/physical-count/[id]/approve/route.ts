import { requireAdmin } from "@/lib/api-auth"
import { approveCountSession } from "@/lib/physical-count"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const sessionId = parseInt(params.id, 10)
  const approvedById = parseInt(authResult.id, 10)

  try {
    await prisma.$transaction(async (tx) => {
      await approveCountSession(tx, sessionId, approvedById)
    })
    return Response.json({ ok: true })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Failed", 400)
  }
}
