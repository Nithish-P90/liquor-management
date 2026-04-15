type FaceApiModule = any

export type FaceCaptureSample = {
  descriptor: number[]
  detectionScore: number
  qualityScore: number
  frameWidth: number
  frameHeight: number
  box: { x: number; y: number; width: number; height: number }
  previewDataUrl: string
}

export type AutoDetectResult = {
  detected: boolean
  descriptor?: number[]
  detectionScore?: number
  qualityScore?: number
  box?: { x: number; y: number; width: number; height: number }
  previewDataUrl?: string
  error?: string
}

let faceApiPromise: Promise<FaceApiModule> | null = null
let modelLoadPromise: Promise<FaceApiModule> | null = null

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function getFaceModelsBaseUrl(): string {
  if (typeof window === 'undefined') return '/face-models'
  if (window.location.protocol === 'file:') {
    return new URL('./face-models/', window.location.href).toString()
  }
  return `${window.location.origin}/face-models`
}

export function getFaceVendorBaseUrl(): string {
  if (typeof window === 'undefined') return '/vendor/face-api'
  if (window.location.protocol === 'file:') {
    return new URL('./vendor/face-api/', window.location.href).toString()
  }
  return `${window.location.origin}/vendor/face-api`
}

async function loadFaceApi(): Promise<FaceApiModule> {
  if (!faceApiPromise) {
    faceApiPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined') {
        reject(new Error('Face API can only be loaded in the browser.'))
        return
      }

      if ((window as Window & { faceapi?: FaceApiModule }).faceapi) {
        resolve((window as Window & { faceapi?: FaceApiModule }).faceapi)
        return
      }

      const scriptUrl = `${getFaceVendorBaseUrl()}/face-api.js`
      const existingScript = document.querySelector<HTMLScriptElement>(`script[data-face-api="${scriptUrl}"]`)
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve((window as Window & { faceapi?: FaceApiModule }).faceapi))
        existingScript.addEventListener('error', () => reject(new Error('Face API failed to load.')))
        return
      }

      const script = document.createElement('script')
      script.src = scriptUrl
      script.async = true
      script.defer = true
      script.dataset.faceApi = scriptUrl
      script.onload = () => resolve((window as Window & { faceapi?: FaceApiModule }).faceapi)
      script.onerror = () => reject(new Error('Face API failed to load.'))
      document.head.appendChild(script)
    })
  }
  return faceApiPromise
}

export async function ensureFaceModelsLoaded(): Promise<FaceApiModule> {
  const faceapi = await loadFaceApi()
  if (!modelLoadPromise) {
    modelLoadPromise = (async () => {
      const modelBaseUrl = getFaceModelsBaseUrl()
      await faceapi.nets.ssdMobilenetv1.loadFromUri(modelBaseUrl)
      await faceapi.nets.faceLandmark68Net.loadFromUri(modelBaseUrl)
      await faceapi.nets.faceRecognitionNet.loadFromUri(modelBaseUrl)
      return faceapi
    })()
  }
  await modelLoadPromise
  return faceapi
}

function computeSharpnessScore(context: CanvasRenderingContext2D, width: number, height: number): number {
  const sampleWidth = 32
  const sampleHeight = 32
  const sampleCanvas = document.createElement('canvas')
  sampleCanvas.width = sampleWidth
  sampleCanvas.height = sampleHeight
  const sampleContext = sampleCanvas.getContext('2d')
  if (!sampleContext) return 0
  sampleContext.drawImage(context.canvas, 0, 0, width, height, 0, 0, sampleWidth, sampleHeight)

  const { data } = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight)
  let sum = 0
  let sumSquares = 0
  let pixels = 0

  for (let y = 1; y < sampleHeight - 1; y += 1) {
    for (let x = 1; x < sampleWidth - 1; x += 1) {
      const index = (y * sampleWidth + x) * 4
      const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
      const left = data[index - 4] * 0.299 + data[index - 3] * 0.587 + data[index - 2] * 0.114
      const right = data[index + 4] * 0.299 + data[index + 5] * 0.587 + data[index + 6] * 0.114
      const up = data[index - sampleWidth * 4] * 0.299 + data[index - sampleWidth * 4 + 1] * 0.587 + data[index - sampleWidth * 4 + 2] * 0.114
      const down = data[index + sampleWidth * 4] * 0.299 + data[index + sampleWidth * 4 + 1] * 0.587 + data[index + sampleWidth * 4 + 2] * 0.114
      const laplacian = (4 * gray) - left - right - up - down
      sum += laplacian
      sumSquares += laplacian * laplacian
      pixels += 1
    }
  }

  if (pixels === 0) return 0
  const mean = sum / pixels
  const variance = sumSquares / pixels - mean * mean
  return clamp(variance / 180, 0, 1)
}

function computeCenterScore(box: { x: number; y: number; width: number; height: number }, width: number, height: number): number {
  const centerX = box.x + box.width / 2
  const centerY = box.y + box.height / 2
  const offsetX = Math.abs(centerX - width / 2) / (width / 2)
  const offsetY = Math.abs(centerY - height / 2) / (height / 2)
  return clamp(1 - ((offsetX + offsetY) / 2), 0, 1)
}

function computeSizeScore(box: { width: number; height: number }, width: number, height: number): number {
  const faceRatio = (box.width * box.height) / (width * height)
  if (faceRatio < 0.02) return 0
  if (faceRatio > 0.45) return 0.55
  return clamp((faceRatio - 0.02) / 0.2, 0, 1)
}

function computeQualityScore(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  box: { x: number; y: number; width: number; height: number },
  detectionScore: number
): number {
  const sharpness = computeSharpnessScore(context, width, height)
  const centerScore = computeCenterScore(box, width, height)
  const sizeScore = computeSizeScore(box, width, height)
  return clamp((detectionScore * 0.55) + (sharpness * 0.2) + (centerScore * 0.15) + (sizeScore * 0.1), 0, 1)
}

/** Single-shot capture: grabs one frame and returns the best face found.
 *  Quality threshold is intentionally lower here (0.35) so enrollment works
 *  across typical webcam conditions. */
export async function captureFaceSample(video: HTMLVideoElement): Promise<FaceCaptureSample> {
  const faceapi = await ensureFaceModelsLoaded()

  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
    throw new Error('Camera is not ready yet.')
  }

  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Unable to create capture canvas.')
  }

  context.drawImage(video, 0, 0, canvas.width, canvas.height)

  // Use lower minConfidence (0.6) so more faces are detected under poor lighting
  const detections = await faceapi
    .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.6 }))
    .withFaceLandmarks()
    .withFaceDescriptors()

  if (detections.length === 0) {
    throw new Error('No face detected. Move closer and make sure your face is well-lit.')
  }

  if (detections.length > 1) {
    throw new Error('Multiple faces detected. Only one person should be in frame.')
  }

  const detection = detections[0]
  const detectionScore = detection.detection.score
  const box = detection.detection.box
  const qualityScore = computeQualityScore(context, canvas.width, canvas.height, box, detectionScore)

  // Lowered from 0.55 → 0.35 so typical overhead-lit office/counter works
  if (qualityScore < 0.35) {
    throw new Error('Image quality too low. Improve lighting or move closer to the camera.')
  }

  return {
    descriptor: Array.from(detection.descriptor),
    detectionScore,
    qualityScore,
    frameWidth: canvas.width,
    frameHeight: canvas.height,
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    previewDataUrl: canvas.toDataURL('image/jpeg', 0.92),
  }
}

/** Lightweight single-frame face probe used by the auto-detect loop.
 *  Returns null when no single face is present — does NOT throw.
 *  minConfidence intentionally low (0.5) so it triggers quickly. */
export async function probeFaceFrame(video: HTMLVideoElement): Promise<AutoDetectResult> {
  try {
    const faceapi = await ensureFaceModelsLoaded()

    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return { detected: false }
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return { detected: false }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const detections = await faceapi
      .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptors()

    if (detections.length !== 1) {
      return { detected: false }
    }

    const det = detections[0]
    const box = det.detection.box
    const qualityScore = computeQualityScore(ctx, canvas.width, canvas.height, box, det.detection.score)

    // Only report as "detected" if quality is at least workable (0.3)
    if (qualityScore < 0.3) {
      return { detected: false }
    }

    return {
      detected: true,
      descriptor: Array.from(det.descriptor),
      detectionScore: det.detection.score,
      qualityScore,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      previewDataUrl: canvas.toDataURL('image/jpeg', 0.85),
    }
  } catch {
    return { detected: false, error: 'probe error' }
  }
}
