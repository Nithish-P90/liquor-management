import { z } from "zod"
import { requireAdmin, requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

export async function GET(): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  try {
    const settingsList = await prisma.setting.findMany()
    const settings = settingsList.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {} as Record<string, string>)
    return Response.json(settings)
  } catch {
    return apiError("Database error", 500)
  }
}

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const parsed = z.record(z.string(), z.string()).safeParse(await req.json())
  if (!parsed.success) return apiError("Invalid settings body format")

  try {
    for (const [key, value] of Object.entries(parsed.data)) {
      await prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    }
    return Response.json({ success: true })
  } catch {
    return apiError("Database error", 500)
  }
}
