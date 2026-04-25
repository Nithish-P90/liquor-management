import { runEndOfDay } from "@/lib/eod"
import { subtractDays, todayDateString } from "@/lib/dates"

export async function POST(req: Request): Promise<Response> {
  const authHeader = req.headers.get("authorization")
  const secret = process.env.CRON_SECRET

  if (!secret) return Response.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  if (authHeader !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 })

  // Run EOD for yesterday (cron fires after midnight)
  const businessDate = subtractDays(todayDateString(), 1)

  try {
    const result = await runEndOfDay(businessDate)
    return Response.json({ ok: true, businessDate, ...result })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "EOD failed" }, { status: 500 })
  }
}
