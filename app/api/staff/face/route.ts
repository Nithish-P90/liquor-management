import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { averageDescriptors, toFaceDescriptor } from '@/lib/face-matching'

export const dynamic = 'force-dynamic'

type FaceSampleInput = {
  descriptor: unknown
  detectionScore?: number
  qualityScore?: number
}

function parseSample(sample: FaceSampleInput) {
  const descriptor = toFaceDescriptor(sample?.descriptor)
  if (!descriptor || descriptor.length !== 128) {
    return null
  }

  return {
    descriptor,
    detectionScore: Number.isFinite(Number(sample.detectionScore)) ? Number(sample.detectionScore) : 0,
    qualityScore: Number.isFinite(Number(sample.qualityScore)) ? Number(sample.qualityScore) : 0,
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      staffId?: number
      samples?: FaceSampleInput[]
      replaceExisting?: boolean
    }

    const staffId = Number(body.staffId)
    if (!Number.isInteger(staffId) || staffId <= 0) {
      return NextResponse.json({ error: 'Missing or invalid staffId.' }, { status: 400 })
    }

    const parsedSamples = Array.isArray(body.samples)
      ? body.samples.map(parseSample).filter((sample): sample is NonNullable<ReturnType<typeof parseSample>> => Boolean(sample))
      : []

    if (parsedSamples.length < 3) {
      return NextResponse.json({ error: 'Capture at least 3 clear face samples before enrolling.' }, { status: 400 })
    }

    const replaceExisting = body.replaceExisting !== false
    const existingProfile = replaceExisting
      ? null
      : await prisma.faceProfile.findUnique({
        where: { staffId },
        include: {
          samples: {
            orderBy: { createdAt: 'asc' },
            select: { descriptor: true, detectionScore: true, qualityScore: true },
          },
        },
      })

    const existingSamples = existingProfile?.samples.map(sample => ({
      descriptor: toFaceDescriptor(sample.descriptor) ?? [],
      detectionScore: Number(sample.detectionScore),
      qualityScore: Number(sample.qualityScore),
    })) ?? []

    const mergedSamples = [...existingSamples, ...parsedSamples].slice(-5)
    if (mergedSamples.length < 3) {
      return NextResponse.json({ error: 'Keep at least 3 samples for a reliable face profile.' }, { status: 400 })
    }

    const centroid = averageDescriptors(mergedSamples.map(sample => sample.descriptor))
    const now = new Date()

    const profile = await prisma.faceProfile.upsert({
      where: { staffId },
      create: {
        staffId,
        descriptor: centroid,
        sampleCount: mergedSamples.length,
        threshold: 0.48,
        enrolledAt: now,
        lastMatchedAt: null,
      },
      update: {
        descriptor: centroid,
        sampleCount: mergedSamples.length,
        threshold: 0.48,
        enrolledAt: now,
      },
    })

    await prisma.faceSample.deleteMany({ where: { profileId: profile.id } })
    await prisma.faceSample.createMany({
      data: mergedSamples.map(sample => ({
        profileId: profile.id,
        descriptor: sample.descriptor,
        detectionScore: sample.detectionScore,
        qualityScore: sample.qualityScore,
      })),
    })

    return NextResponse.json({
      success: true,
      staffId,
      sampleCount: mergedSamples.length,
      threshold: profile.threshold,
      descriptor: centroid,
      message: mergedSamples.length >= 5
        ? 'Face profile enrolled with 5 samples.'
        : `Face profile enrolled with ${mergedSamples.length} samples.`,
    })
  } catch (error: any) {
    console.error('[staff face POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json() as { staffId?: number }
    const staffId = Number(body.staffId)
    if (!Number.isInteger(staffId) || staffId <= 0) {
      return NextResponse.json({ error: 'Missing or invalid staffId.' }, { status: 400 })
    }

    await prisma.faceProfile.deleteMany({ where: { staffId } })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[staff face DELETE]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
