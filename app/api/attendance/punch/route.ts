import { z } from "zod"

import { requireSession } from "@/lib/api-auth"
import { punch } from "@/lib/attendance"
import { apiError } from "@/lib/zod-schemas"

const bodySchema = z.object({
  staffId: z.number().int().positive(),
  method: z.enum(["FACE", "PIN", "MANUAL_OVERRIDE"]),
  confidenceScore: z.number().min(0).max(1).optional(),
  overrideReason: z.string().optional(),
  requestId: z.string().min(10).max(128).optional(),
  deviceLabel: z.string().max(128).optional(),
})

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid body")

  try {
    const result = await punch({
      ...parsed.data,
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    })
    return Response.json(result)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Punch failed", 500)
  }
}
