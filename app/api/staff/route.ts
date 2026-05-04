import { z } from "zod"
import { requireAdmin, requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/platform/prisma"
import { apiError } from "@/lib/zod-schemas"
import { staffMetrics } from "@/lib/domains/staff/metrics"

export async function GET(): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  try {
    const [metrics, staffList] = await Promise.all([
      staffMetrics(),
      prisma.staff.findMany({
        where: { active: true },
        select: {
          id: true,
          payrollType: true,
          pin: true,
          monthlySalary: true,
          dailyWage: true,
          lateGraceMinutes: true,
          faceProfile: { select: { enrolledAt: true, sampleCount: true } },
          shiftTemplates: {
            where: { isActive: true },
            select: { id: true, startTime: true, endTime: true, activeDays: true },
            take: 1,
          },
        },
      }),
    ])

    const detailMap = new Map(staffList.map((s) => [s.id, s]))

    const combined = metrics.map((m) => {
      const detail = detailMap.get(m.staffId) ?? null
      return {
        id: m.staffId,
        name: m.name,
        role: m.role,
        payrollType: detail?.payrollType ?? "SALARY",
        pin: detail?.pin ?? null,
        monthlySalary: detail?.monthlySalary !== null && detail?.monthlySalary !== undefined ? Number(detail.monthlySalary) : null,
        dailyWage: detail?.dailyWage !== null && detail?.dailyWage !== undefined ? Number(detail.dailyWage) : null,
        lateGraceMinutes: detail?.lateGraceMinutes ?? 15,
        faceEnrolled: !!detail?.faceProfile?.enrolledAt,
        faceSampleCount: detail?.faceProfile?.sampleCount ?? 0,
        shift: detail?.shiftTemplates?.[0] ?? null,
        billsHandled: m.billsHandled,
        totalRevenue: m.totalRevenue,
        ownerNetRevenue: m.ownerNetRevenue,
        thirdPartyRevenue: m.thirdPartyRevenue,
        attendanceDays: m.attendanceDays,
      }
    })

    return Response.json(combined)
  } catch (err) {
    console.error("Staff GET error:", err)
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
    monthlySalary: z.number().positive().optional().nullable(),
    dailyWage: z.number().positive().optional().nullable(),
    lateGraceMinutes: z.number().int().min(0).max(120).optional(),
    shift: z.object({
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
      activeDays: z.array(z.number().int().min(0).max(6)),
    }).optional().nullable(),
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
          monthlySalary: parsed.data.monthlySalary ?? null,
          dailyWage: parsed.data.dailyWage ?? null,
          lateGraceMinutes: parsed.data.lateGraceMinutes ?? 15,
        },
      })

      if (parsed.data.shift) {
        await tx.shiftTemplate.create({
          data: {
            staffId: staff.id,
            startTime: parsed.data.shift.startTime,
            endTime: parsed.data.shift.endTime,
            activeDays: parsed.data.shift.activeDays,
            isActive: true,
          },
        })
      }

      if (parsed.data.role === "SUPPLIER") {
        const existingClerk = await tx.clerk.findFirst({ where: { name: parsed.data.name, isActive: true } })
        if (!existingClerk) {
          await tx.clerk.create({ data: { name: parsed.data.name, isActive: true } })
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
