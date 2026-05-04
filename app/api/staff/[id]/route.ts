import { z } from "zod"
import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/platform/prisma"
import { apiError } from "@/lib/zod-schemas"

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  role: z.enum(["ADMIN", "CASHIER", "SUPPLIER", "HELPER", "LOADER", "COLLECTOR", "CLEANER", "WATCHMAN", "OTHER"]).optional(),
  payrollType: z.enum(["SALARY", "DAILY"]).optional(),
  pin: z.string().regex(/^\d{4}$/).optional().nullable(),
  active: z.boolean().optional(),
  monthlySalary: z.number().positive().optional().nullable(),
  dailyWage: z.number().positive().optional().nullable(),
  lateGraceMinutes: z.number().int().min(0).max(120).optional(),
  shift: z.object({
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    activeDays: z.array(z.number().int().min(0).max(6)),
  }).optional().nullable(),
})

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const id = parseInt(params.id, 10)
  if (isNaN(id)) return apiError("Invalid ID", 400)

  try {
    const staff = await prisma.staff.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        role: true,
        payrollType: true,
        pin: true,
        monthlySalary: true,
        dailyWage: true,
        lateGraceMinutes: true,
        active: true,
        faceProfile: { select: { enrolledAt: true, sampleCount: true, threshold: true } },
        shiftTemplates: {
          where: { isActive: true },
          select: { id: true, startTime: true, endTime: true, activeDays: true },
        },
      },
    })
    if (!staff) return apiError("Not found", 404)
    return Response.json(staff)
  } catch (err) {
    console.error("Staff GET error:", err)
    return apiError("Database error", 500)
  }
}

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const id = parseInt(params.id, 10)
  if (isNaN(id)) return apiError("Invalid ID", 400)

  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid body")

  const { shift, ...staffFields } = parsed.data

  try {
    if (staffFields.pin) {
      const existing = await prisma.staff.findFirst({
        where: { pin: staffFields.pin, id: { not: id } },
      })
      if (existing) return apiError("PIN already in use", 400)
    }

    await prisma.$transaction(async (tx) => {
      await tx.staff.update({ where: { id }, data: staffFields })

      if (shift !== undefined) {
        await tx.shiftTemplate.updateMany({ where: { staffId: id, isActive: true }, data: { isActive: false } })
        if (shift !== null) {
          await tx.shiftTemplate.create({
            data: { staffId: id, startTime: shift.startTime, endTime: shift.endTime, activeDays: shift.activeDays, isActive: true },
          })
        }
      }
    })

    return Response.json({ ok: true })
  } catch (err) {
    console.error("Staff update error:", err)
    return apiError("Database error", 500)
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const id = parseInt(params.id, 10)
  if (isNaN(id)) return apiError("Invalid ID", 400)

  try {
    // Soft delete by setting active = false
    await prisma.staff.update({
      where: { id },
      data: { active: false },
    })
    return Response.json({ success: true })
  } catch (err) {
    console.error("Staff delete error:", err)
    return apiError("Database error", 500)
  }
}
