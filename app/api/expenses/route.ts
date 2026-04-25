import { z } from "zod"

import { requireAdmin, requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError, zDateString } from "@/lib/zod-schemas"
import { parseDateParam } from "@/lib/dates"

const createSchema = z.object({
  expDate: zDateString,
  particulars: z.string().trim().min(1),
  category: z.string().trim().optional(),
  categoryId: z.number().int().positive().optional(),
  amount: z.number().positive(),
})

export async function GET(req: Request): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  const url = new URL(req.url)
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")

  try {
    const expenses = await prisma.expenditure.findMany({
      where: from && to ? {
        expDate: { gte: parseDateParam(from), lte: parseDateParam(to) },
      } : {},
      include: { categoryRef: { select: { name: true } } },
      orderBy: { expDate: "desc" },
      take: 200,
    })
    return Response.json(expenses)
  } catch {
    return apiError("Database error", 500)
  }
}

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid body")

  const { expDate, particulars, category, categoryId, amount } = parsed.data

  try {
    const expense = await prisma.expenditure.create({
      data: {
        expDate: parseDateParam(expDate),
        particulars,
        category: category ?? "OTHER",
        categoryId: categoryId ?? null,
        amount,
        recordedById: parseInt(authResult.id, 10),
      },
      include: { categoryRef: { select: { name: true } } },
    })
    return Response.json(expense, { status: 201 })
  } catch {
    return apiError("Database error", 500)
  }
}
