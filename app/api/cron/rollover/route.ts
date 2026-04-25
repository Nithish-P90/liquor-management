import { ensureDailyRollover } from "@/lib/rollover"

export async function POST(req: Request): Promise<Response> {
  const authHeader = req.headers.get("authorization")
  const secret = process.env.CRON_SECRET

  if (!secret) {
    return Response.json({ error: "CRON_SECRET is not configured" }, { status: 500 })
  }

  if (authHeader !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const status = await ensureDailyRollover()
    return Response.json({ status })
  } catch {
    return Response.json({ error: "Rollover failed" }, { status: 500 })
  }
}
