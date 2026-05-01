import { requireSession } from "@/lib/api-auth"
import { listActiveAlerts } from "@/lib/alerts"
import { apiError } from "@/lib/zod-schemas"

export async function GET(): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  try {
    const alerts = await listActiveAlerts(50)
    return Response.json(alerts)
  } catch {
    return apiError("Database error", 500)
  }
}
