import { z } from "zod"

import { requireAdmin, requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

export async function GET(_req: Request): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  try {
    const clerks = await prisma.clerk.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    })
    return Response.json(clerks)
  } catch {
    return apiError("Database error", 500)
  }
}

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const parsed = z.object({ name: z.string().trim().min(1) }).safeParse(await req.json())
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid body")

  try {
    const clerk = await prisma.clerk.create({ data: { name: parsed.data.name } })
    return Response.json(clerk, { status: 201 })
  } catch {
    return apiError("Database error", 500)
  }
}
