import { requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { computeGallaBalance } from "@/lib/galla"
import { todayDateString } from "@/lib/dates"
import { parseDateParam } from "@/lib/dates"
import { apiError } from "@/lib/zod-schemas"

export async function GET(req: Request): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  const url = new URL(req.url)
  const dateStr = url.searchParams.get("date") ?? todayDateString()

  try {
    const dateObj = parseDateParam(dateStr)
    const day = await prisma.gallaDay.findUnique({
      where: { businessDate: dateObj },
      include: { events: { orderBy: { occurredAt: "asc" } } },
    })

    if (!day) {
      return Response.json({ date: dateStr, balance: "0.00", events: [], isClosed: false })
    }

    const balance = await computeGallaBalance(prisma as any, day.id)
    return Response.json({ ...day, balance: balance.toString() })
  } catch {
    return apiError("Database error", 500)
  }
}
