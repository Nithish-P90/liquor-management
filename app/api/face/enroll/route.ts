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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const delta = a[i] - (b[i] ?? 0)
    sum += delta * delta
  }
  return Math.sqrt(sum)
}

function weightedMeanDescriptor(samples: Array<{ descriptor: number[]; qualityScore: number; detectionScore: number }>): number[] {
  const dims = samples[0]?.descriptor.length ?? 0
  const acc = new Array(dims).fill(0) as number[]
  let totalWeight = 0

  for (const sample of samples) {
    const weight = clamp(sample.qualityScore * 0.7 + sample.detectionScore * 0.3, 0.1, 1)
    totalWeight += weight
    for (let i = 0; i < dims; i++) {
      acc[i] += (sample.descriptor[i] ?? 0) * weight
    }
  }

  if (totalWeight <= 0) return acc

  for (let i = 0; i < dims; i++) {
    acc[i] /= totalWeight
  }
  return acc
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function computeAdaptiveThreshold(
  samples: Array<{ descriptor: number[]; qualityScore: number; detectionScore: number }>,
  centroid: number[],
): number {
  const avgQuality = average(samples.map((sample) => sample.qualityScore))
  const avgDetection = average(samples.map((sample) => sample.detectionScore))
  const spread = average(samples.map((sample) => euclideanDistance(sample.descriptor, centroid)))

  // Higher-quality samples get a stricter threshold; noisier enrollments get a slightly wider one.
  const base = 0.46 + (1 - avgQuality) * 0.05 + (1 - avgDetection) * 0.03
  const adjusted = base + Math.min(0.04, spread * 0.15)
  return clamp(adjusted, 0.38, 0.54)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

    const ranked = samples
      .slice()
      .sort((a, b) => (b.qualityScore * 0.7 + b.detectionScore * 0.3) - (a.qualityScore * 0.7 + a.detectionScore * 0.3))
      .slice(0, Math.min(10, samples.length))

    const centroidSeed = weightedMeanDescriptor(ranked)
    const spread = average(ranked.map((sample) => euclideanDistance(sample.descriptor, centroidSeed)))
    const filtered = ranked.filter((sample) => euclideanDistance(sample.descriptor, centroidSeed) <= spread * 1.35 || ranked.length <= 4)
    const best = filtered.length >= 3 ? filtered : ranked

    const aggregated = weightedMeanDescriptor(best)
    const threshold = computeAdaptiveThreshold(best, aggregated)

    const profile = await prisma.faceProfile.upsert({
      where: { staffId },
      update: {
        descriptor: aggregated,
        threshold,
        sampleCount: best.length,
        enrolledAt: new Date(),
      },
      create: {
        staffId,
        descriptor: aggregated,
        threshold,
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

