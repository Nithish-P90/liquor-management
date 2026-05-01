import { z } from "zod"

import { requireAdmin, requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

export async function GET(): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  try {
    // Sync: Ensure all active staff suppliers have a clerk record
    const [activeSuppliers, existingClerks] = await Promise.all([
      prisma.staff.findMany({
        where: { role: "SUPPLIER", active: true },
        select: { name: true },
      }),
      prisma.clerk.findMany({
        where: { isActive: true },
        select: { name: true },
      }),
    ])

    const existingNames = new Set(existingClerks.map((c) => c.name.toLowerCase()))
    const missing = activeSuppliers.filter((s) => !existingNames.has(s.name.toLowerCase()))

    if (missing.length > 0) {
      // Use createMany if possible, but manual check is safer for duplicates without unique constraint
      // However, we already filtered 'missing' above.
      await prisma.clerk.createMany({
        data: missing.map((s) => ({ name: s.name })),
      })
    }

    const clerks = await prisma.clerk.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    })
    return Response.json(clerks)
  } catch (err) {
    console.error("Clerks sync error:", err)
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
