import { z } from "zod"

import { requireAdmin, requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

export async function GET(): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  try {
    const cats = await prisma.expenseCategory.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    })
    return Response.json(cats)
  } catch {
    return apiError("Database error", 500)
  }
}

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const parsed = z.object({
    name: z.string().trim().min(1),
    description: z.string().trim().optional(),
  }).safeParse(await req.json())

  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid body")

  try {
    const cat = await prisma.expenseCategory.create({ data: parsed.data })
    return Response.json(cat, { status: 201 })
  } catch {
    return apiError("Category name already exists", 409)
  }
}
