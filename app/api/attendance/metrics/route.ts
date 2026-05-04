import { z } from "zod"
import { requireAdmin } from "@/lib/api-auth"
import { apiError } from "@/lib/zod-schemas"
import { attendanceMetrics } from "@/lib/domains/attendance/metrics"

const querySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM"),
  staffId: z.string().regex(/^\d+$/).optional(),
})

export async function GET(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    month: url.searchParams.get("month") ?? undefined,
    staffId: url.searchParams.get("staffId") ?? undefined,
  })
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid query")

  try {
    const result = await attendanceMetrics({
      month: parsed.data.month,
      staffId: parsed.data.staffId ? parseInt(parsed.data.staffId, 10) : undefined,
    })
    return Response.json(result)
  } catch (err) {
    console.error("Attendance metrics error:", err)
    return apiError("Failed to load metrics", 500)
  }
}
