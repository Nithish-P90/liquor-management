import { z } from "zod"

import { requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

const bodySchema = z.object({
  staffId: z.number().int().positive(),
  samples: z.array(z.object({
    descriptor: z.array(z.number()),
    detectionScore: z.number().min(0).max(1),
    qualityScore: z.number().min(0).max(1),
  })).min(3).max(15),
})

function meanDescriptor(vectors: number[][]): number[] {
  const dims = vectors[0]?.length ?? 0
  const acc = new Array(dims).fill(0) as number[]
  for (const v of vectors) {
    for (let i = 0; i < dims; i++) acc[i] += v[i] ?? 0
  }
  for (let i = 0; i < dims; i++) acc[i] /= vectors.length
  return acc
}

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid body")

  const { staffId, samples } = parsed.data

  try {
    const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { id: true } })
    if (!staff) return apiError("Staff not found", 404)

    const best = samples
      .slice()
      .sort((a, b) => (b.qualityScore * 0.7 + b.detectionScore * 0.3) - (a.qualityScore * 0.7 + a.detectionScore * 0.3))
      .slice(0, Math.min(10, samples.length))

    const aggregated = meanDescriptor(best.map((s) => s.descriptor))

    const profile = await prisma.faceProfile.upsert({
      where: { staffId },
      update: {
        descriptor: aggregated,
        threshold: 0.48,
        sampleCount: best.length,
        enrolledAt: new Date(),
      },
      create: {
        staffId,
        descriptor: aggregated,
        threshold: 0.48,
        sampleCount: best.length,
        enrolledAt: new Date(),
      },
    })

    await prisma.faceSample.createMany({
      data: best.map((s) => ({
        profileId: profile.id,
        descriptor: s.descriptor,
        detectionScore: s.detectionScore,
        qualityScore: s.qualityScore,
      })),
    })

    return Response.json({ ok: true, sampleCount: profile.sampleCount })
  } catch {
    return apiError("Enrollment failed", 500)
  }
}

