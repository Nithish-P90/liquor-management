import { z } from "zod"

import { requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { closeGallaDay } from "@/lib/galla"
import { parseDateParam, todayDateString } from "@/lib/dates"
import { apiError } from "@/lib/zod-schemas"

const bodySchema = z.object({
  date: z.string().optional(),
  countedAmount: z.number().nonnegative(),
})

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid body")

  const dateStr = parsed.data.date ?? todayDateString()
  const actorId = parseInt(authResult.id, 10)

  try {
    const dateObj = parseDateParam(dateStr)
    let day = await prisma.gallaDay.findUnique({ where: { businessDate: dateObj } })

    if (!day) {
      day = await prisma.gallaDay.create({ data: { businessDate: dateObj } })
    }

    if (day.isClosed) return apiError("Galla day already closed", 400)

    const result = await prisma.$transaction(async (tx) => {
      return closeGallaDay(tx, day!.id, parsed.data.countedAmount, actorId)
    })

    return Response.json({ ok: true, variance: result.variance.toString() })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Close failed", 500)
  }
}
