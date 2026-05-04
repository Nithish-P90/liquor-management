import { parseDateParam, todayDateString } from "@/lib/platform/dates"
import { prisma } from "@/lib/platform/prisma"
import { requireApiAuth, jsonOk, apiError } from "@/lib/api/handler"
import { ensureDailyRollover } from "@/lib/domains/inventory/rollover"

export async function GET(req: Request): Promise<Response> {
  const authResult = await requireApiAuth("session", req)
  if (authResult instanceof Response) return authResult

  try {
    const today = todayDateString()
    const dateObj = parseDateParam(today)

    await ensureDailyRollover()

    const session = await prisma.inventorySession.findFirst({
      where: {
        periodStart: { lte: dateObj },
        periodEnd: { gte: dateObj },
      },
      orderBy: { id: "desc" },
      select: { id: true, periodStart: true, periodEnd: true, locked: true, staffId: true },
    })

    // Check if we're in "no_history" state
    let rolloverStatus: "up_to_date" | "rolled_over" | "no_history" = "up_to_date"

    if (!session) {
      const anySession = await prisma.inventorySession.findFirst({
        select: { id: true },
      })
      rolloverStatus = anySession ? "rolled_over" : "no_history"
    }

    return jsonOk({
      session: session || null,
      rolloverStatus,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Failed to fetch session", 500)
  }
}
