import { z } from "zod"

import { requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/platform/prisma"
import { parseDateParam, todayDateString } from "@/lib/platform/dates"
import { getOrCreateGallaDay } from "@/lib/domains/cash/galla"
import { transferGallaToLocker, transferGallaToBank } from "@/lib/domains/cash/locker"

const bodySchema = z.object({
  type: z.enum(["LOCKER", "BANK"]),
  amount: z.number().positive(),
  reference: z.string().optional(),
  date: z.string().optional(),
})

export async function POST(req: Request): Promise<Response> {
  const auth = await requireSession()
  if (auth instanceof Response) return auth

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 })
  }

  const { type, amount, reference, date } = parsed.data
  const dateObj = parseDateParam(date ?? todayDateString())
  const amt = amount

  try {
    await prisma.$transaction(async (tx) => {
      const day = await getOrCreateGallaDay(tx, dateObj)
      if (day.isClosed) throw new Error("Cash register is closed for this date")

      if (type === "LOCKER") {
        await transferGallaToLocker(tx, { gallaDayId: day.id, amount: amt, reference })
      } else {
        await transferGallaToBank(tx, { gallaDayId: day.id, amount: amt, reference })
      }
    })

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Transfer failed" }, { status: 400 })
  }
}
