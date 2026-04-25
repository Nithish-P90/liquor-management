import { requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

export async function GET(_req: Request): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  try {
    const staff = await prisma.staff.findMany({
      where: { active: true },
      select: { id: true, name: true, role: true, payrollType: true },
      orderBy: { name: "asc" },
    })
    return Response.json(staff)
  } catch {
    return apiError("Database error", 500)
  }
}
