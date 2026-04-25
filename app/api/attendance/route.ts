import { requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"
import { parseDateParam, todayDateString } from "@/lib/dates"

export async function GET(req: Request): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  const url = new URL(req.url)
  const dateStr = url.searchParams.get("date") ?? todayDateString()

  try {
    const dateObj = parseDateParam(dateStr)
    const dayEnd = new Date(dateObj.getTime() + 86400000)

    const events = await prisma.attendanceEvent.findMany({
      where: { occurredAt: { gte: dateObj, lt: dayEnd } },
      include: { staff: { select: { name: true, role: true } } },
      orderBy: { occurredAt: "desc" },
    })
    return Response.json(events)
  } catch {
    return apiError("Database error", 500)
  }
}
