export type FaceDescriptorInput = ArrayLike<number> | number[]

export type FaceSampleDescriptor = {
  descriptor: number[]
  detectionScore?: number
  qualityScore?: number
}

export type FaceProfileSummary = {
  staffId: number
  staffName: string
  role: string
  threshold?: number | null
  sampleCount?: number | null
  descriptor?: number[] | null
  samples?: FaceSampleDescriptor[]
}

export type FaceMatchResult = {
  staffId: number
  staffName: string
  role: string
  distance: number
  confidence: number
  threshold: number
  sampleCount: number
  descriptor: number[] | null
}

export type FaceMatchOutcome = {
  match: FaceMatchResult | null
  ranked: FaceMatchResult[]
  reason: string | null
}

export function toFaceDescriptor(value: unknown): number[] | null {
  if (!Array.isArray(value) && !(value instanceof Float32Array)) return null
  const descriptor = Array.from(value as ArrayLike<number>)
    .map(Number)
    .filter(Number.isFinite)
  return descriptor.length > 0 ? descriptor : null
}

export function normalizeDescriptor(descriptor: FaceDescriptorInput): number[] {
  const values = Array.from(descriptor as ArrayLike<number>).map(Number)
  const length = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0))
  if (!Number.isFinite(length) || length === 0) return values
  return values.map(value => value / length)
}

export function averageDescriptors(descriptors: FaceDescriptorInput[]): number[] {
  if (descriptors.length === 0) return []
  const normalized = descriptors.map(normalizeDescriptor)
  const vectorLength = normalized[0].length
  const totals = new Array<number>(vectorLength).fill(0)

  for (const descriptor of normalized) {
    for (let index = 0; index < vectorLength; index += 1) {
      totals[index] += descriptor[index] ?? 0
    }
  }

  const averaged = totals.map(total => total / normalized.length)
  return normalizeDescriptor(averaged)
}

export function euclideanDistance(left: FaceDescriptorInput, right: FaceDescriptorInput): number {
  const leftValues = Array.from(left as ArrayLike<number>).map(Number)
  const rightValues = Array.from(right as ArrayLike<number>).map(Number)
  const length = Math.min(leftValues.length, rightValues.length)
  let total = 0

  for (let index = 0; index < length; index += 1) {
    const delta = (leftValues[index] ?? 0) - (rightValues[index] ?? 0)
    total += delta * delta
  }

  return Math.sqrt(total)
}

function scoreConfidence(distance: number, threshold: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(threshold) || threshold <= 0) return 0
  const raw = 1 - distance / threshold
  return Math.max(0, Math.min(1, raw))
}

export function findBestFaceMatch(
  descriptor: FaceDescriptorInput,
  profiles: FaceProfileSummary[],
  options?: { defaultThreshold?: number; margin?: number }
): FaceMatchOutcome {
  const defaultThreshold = options?.defaultThreshold ?? 0.48
  const margin = options?.margin ?? 0.05
  const input = normalizeDescriptor(descriptor)

  const ranked = profiles
    .map(profile => {
      const candidates: number[][] = []
      if (Array.isArray(profile.descriptor) && profile.descriptor.length > 0) {
        candidates.push(profile.descriptor)
      }
      if (Array.isArray(profile.samples)) {
        for (const sample of profile.samples) {
          if (Array.isArray(sample.descriptor) && sample.descriptor.length > 0) {
            candidates.push(sample.descriptor)
          }
        }
      }

      const threshold = Number.isFinite(profile.threshold ?? NaN)
        ? Number(profile.threshold)
        : defaultThreshold
      const bestDistance = candidates.length > 0
        ? Math.min(...candidates.map(candidate => euclideanDistance(input, candidate)))
        : Number.POSITIVE_INFINITY

      return {
        staffId: profile.staffId,
        staffName: profile.staffName,
        role: profile.role,
        distance: bestDistance,
        confidence: scoreConfidence(bestDistance, threshold),
        threshold,
        sampleCount: profile.sampleCount ?? candidates.length,
        descriptor: Array.isArray(profile.descriptor) ? profile.descriptor : null,
      } satisfies FaceMatchResult
    })
    .sort((left, right) => left.distance - right.distance)

  if (ranked.length === 0) {
    return { match: null, ranked: [], reason: 'No enrolled faces found.' }
  }

  const best = ranked[0]
  const runnerUp = ranked[1]

  if (!Number.isFinite(best.distance)) {
    return { match: null, ranked, reason: 'No usable face descriptors were available.' }
  }

  if (best.distance > best.threshold) {
    return { match: null, ranked, reason: 'No face matched the enrolled profiles.' }
  }

  if (runnerUp && runnerUp.distance - best.distance < margin) {
    return { match: null, ranked, reason: 'Face match was ambiguous. Please capture again.' }
  }

  return { match: best, ranked, reason: null }
}
