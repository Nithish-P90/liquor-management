import { requireSession } from "@/lib/api-auth"
import { dismissAlert } from "@/lib/alerts"
import { apiError } from "@/lib/zod-schemas"

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  try {
    await dismissAlert(parseInt(params.id, 10))
    return Response.json({ ok: true })
  } catch {
    return apiError("Database error", 500)
  }
}
