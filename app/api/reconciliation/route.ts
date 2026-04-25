import { z } from "zod"

import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError, zDateString } from "@/lib/zod-schemas"
import { parseDateParam } from "@/lib/dates"

const patchSchema = z.object({
  businessDate: zDateString,
  actualCash: z.number().nonnegative().optional(),
  actualCard: z.number().nonnegative().optional(),
  actualUpi: z.number().nonnegative().optional(),
  notes: z.string().optional(),
})

export async function GET(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const url = new URL(req.url)
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")

  try {
    const where = from && to ? {
      businessDate: { gte: parseDateParam(from), lte: parseDateParam(to) },
    } : {}

    const rows = await prisma.paymentReconciliation.findMany({
      where,
      orderBy: { businessDate: "desc" },
      take: 60,
    })
    return Response.json(rows)
  } catch {
    return apiError("Database error", 500)
  }
}

export async function PATCH(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid body")

  const { businessDate, actualCash, actualCard, actualUpi, notes } = parsed.data
  const dateObj = parseDateParam(businessDate)
  const actorId = parseInt(authResult.id, 10)

  try {
    const row = await prisma.paymentReconciliation.findUnique({ where: { businessDate: dateObj } })
    if (!row) return apiError("No reconciliation row for this date", 404)

    const data: Record<string, unknown> = { notes, reconciledById: actorId, reconciledAt: new Date() }
    if (actualCash != null) { data.actualCash = actualCash; data.cashVariance = actualCash - Number(row.systemCash) }
    if (actualCard != null) { data.actualCard = actualCard; data.cardVariance = actualCard - Number(row.systemCard) }
    if (actualUpi != null) { data.actualUpi = actualUpi; data.upiVariance = actualUpi - Number(row.systemUpi) }

    const updated = await prisma.paymentReconciliation.update({ where: { businessDate: dateObj }, data })
    return Response.json(updated)
  } catch {
    return apiError("Database error", 500)
  }
}
