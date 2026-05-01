import { z } from "zod"
import { requireAdmin, requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

export async function GET(): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  try {
    const staff = await prisma.staff.findMany({
      where: { active: true },
      select: { id: true, name: true, role: true, payrollType: true, pin: true, email: true },
      orderBy: { name: "asc" },
    })
    return Response.json(staff)
  } catch {
    return apiError("Database error", 500)
  }
}

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const parsed = z.object({
    name: z.string().trim().min(1),
    role: z.enum(["ADMIN", "CASHIER", "SUPPLIER", "HELPER", "LOADER", "COLLECTOR", "CLEANER", "WATCHMAN", "OTHER"]),
    payrollType: z.enum(["SALARY", "DAILY"]),
    pin: z.string().regex(/^\d{4}$/).optional().nullable(),
  }).safeParse(await req.json())

  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid body")

  try {
    if (parsed.data.pin) {
      const existing = await prisma.staff.findUnique({ where: { pin: parsed.data.pin } })
      if (existing) return apiError("PIN already in use", 400)
    }

    const result = await prisma.$transaction(async (tx) => {
      const staff = await tx.staff.create({
        data: {
          name: parsed.data.name,
          role: parsed.data.role,
          payrollType: parsed.data.payrollType,
          pin: parsed.data.pin || null,
        }
      })

      if (parsed.data.role === "SUPPLIER") {
        const existingClerk = await tx.clerk.findFirst({
          where: { name: parsed.data.name, isActive: true }
        })
        if (!existingClerk) {
          await tx.clerk.create({
            data: {
              name: parsed.data.name,
              isActive: true
            }
          })
        }
      }

      return staff
    })

    return Response.json(result, { status: 201 })
  } catch (err) {
    console.error("Staff creation error:", err)
    return apiError("Database error", 500)
  }
}
