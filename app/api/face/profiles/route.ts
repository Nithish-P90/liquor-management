import { requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

export async function GET(): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  try {
    const profiles = await prisma.faceProfile.findMany({
      include: {
        staff: { select: { id: true, name: true, role: true, active: true } },
      },
    })

    return Response.json(
      profiles
        .filter((p) => p.staff.active)
        .map((p) => ({
          staffId: p.staffId,
          staffName: p.staff.name,
          staffRole: p.staff.role,
          threshold: p.threshold,
          sampleCount: p.sampleCount,
          descriptor: p.descriptor,
        })),
    )
  } catch {
    return apiError("Database error", 500)
  }
}

