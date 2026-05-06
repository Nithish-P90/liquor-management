"use client"

import { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import * as faceapi from "face-api.js"
import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"
import { Camera, CheckCircle, XCircle, RefreshCw } from "lucide-react"

type StaffDetail = {
  id: number
  name: string
  role: string
  faceProfile: { enrolledAt: string | null; sampleCount: number } | null
}

type Sample = {
  descriptor: number[]
  detectionScore: number
  qualityScore: number
  pose: string
}

const POSES = [
  { label: "Look straight at the camera", key: "straight" },
  { label: "Turn slightly to the left", key: "left" },
  { label: "Turn slightly to the right", key: "right" },
]
const SAMPLES_PER_POSE = 5
const TOTAL_SAMPLES = POSES.length * SAMPLES_PER_POSE

function euclideanDist(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((s, v, i) => s + (v - (b[i] ?? 0)) ** 2, 0))
}

function estimateQuality(det: faceapi.WithFaceDescriptor<faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }, faceapi.FaceLandmarks68>>): number {
  const box = det.detection.box
  // Quality: bigger face = better, combined with detection score
  const sizeScore = Math.min(1, (box.width * box.height) / (220 * 220))
  return sizeScore * 0.5 + det.detection.score * 0.5
}

export default function FaceEnrollPage(): JSX.Element {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const staffId = parseInt(params.id, 10)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [staff, setStaff] = useState<StaffDetail | null>(null)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [cameraActive, setCameraActive] = useState(false)

  const [samples, setSamples] = useState<Sample[]>([])
  const [currentPoseIndex, setCurrentPoseIndex] = useState(0)
  const [capturing, setCapturing] = useState(false)
  const [statusMsg, setStatusMsg] = useState("")
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "done" | "error">("idle")
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Load staff detail
  useEffect(() => {
    fetch(`/api/staff/${staffId}`)
      .then((r) => r.json())
      .then((d) => setStaff(d))
      .catch(() => setLoadError("Failed to load staff"))
  }, [staffId])

  // Load face-api models
  useEffect(() => {
    async function loadModels(): Promise<void> {
      try {
        setStatusMsg("Loading face recognition models…")
        // Load high-accuracy full models (SSD + full landmark + recognition)
        // Falls back gracefully if only tiny models are installed
        try {
          await faceapi.nets.ssdMobilenetv1.loadFromUri("/models")
          await faceapi.nets.faceLandmark68Net.loadFromUri("/models")
        } catch {
          await faceapi.nets.tinyFaceDetector.loadFromUri("/models")
          await faceapi.nets.faceLandmark68TinyNet.loadFromUri("/models")
        }
        await faceapi.nets.faceRecognitionNet.loadFromUri("/models")
        setModelsLoaded(true)
        setStatusMsg("Models ready. Start the camera to begin enrollment.")
      } catch {
        setLoadError("Face models not found. Run: npm run setup:face-models")
      }
    }
    loadModels()
  }, [])

  async function startCamera(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraActive(true)
      setStatusMsg(POSES[0]?.label ?? "")
    } catch {
      setLoadError("Cannot access camera. Please allow camera permissions.")
    }
  }

  function stopCamera(): void {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraActive(false)
  }

  function isSsdLoaded(): boolean {
    return faceapi.nets.ssdMobilenetv1.isLoaded
  }

  async function captureFrames(): Promise<void> {
    if (!videoRef.current || capturing) return
    const video = videoRef.current
    const pose = POSES[currentPoseIndex]
    if (!pose) return

    setCapturing(true)
    const newSamples: Sample[] = []
    const maxAttempts = 40
    let attempts = 0

    setStatusMsg(`Capturing ${pose.label}…`)

    while (newSamples.length < SAMPLES_PER_POSE && attempts < maxAttempts) {
      attempts++

      let det: faceapi.WithFaceDescriptor<faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }, faceapi.FaceLandmarks68>> | null = null

      try {
        const raw = isSsdLoaded()
          ? await faceapi.detectSingleFace(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.6 })).withFaceLandmarks().withFaceDescriptor()
          : await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })).withFaceLandmarks(true).withFaceDescriptor()
        det = raw ?? null
      } catch { /* continue */ }

      if (!det) {
        setStatusMsg(`No face detected. ${pose.label}.`)
        await delay(250)
        continue
      }

      const quality = estimateQuality(det)

      // Reject blurry/small faces
      if (quality < 0.2) {
        setStatusMsg("Face too small or blurry. Move closer.")
        await delay(200)
        continue
      }

      // Reject if too similar to an existing sample in this batch (avoid duplicates)
      const desc = Array.from(det.descriptor)
      const tooSimilar = newSamples.some((s) => euclideanDist(s.descriptor, desc) < 0.05)
      if (tooSimilar) {
        await delay(150)
        continue
      }

      newSamples.push({
        descriptor: desc,
        detectionScore: det.detection.score,
        qualityScore: quality,
        pose: pose.key,
      })

      // Draw detection on canvas
      if (canvasRef.current) {
        const canvas = canvasRef.current
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        faceapi.matchDimensions(canvas, { width: video.videoWidth, height: video.videoHeight })
        const ctx = canvas.getContext("2d")
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          faceapi.draw.drawDetections(canvas, [det.detection])
          faceapi.draw.drawFaceLandmarks(canvas, [det.landmarks])
        }
      }

      setStatusMsg(`${pose.label} — ${newSamples.length}/${SAMPLES_PER_POSE} captured`)
      await delay(300)
    }

    setSamples((prev) => [...prev, ...newSamples])

    if (newSamples.length < SAMPLES_PER_POSE) {
      setStatusMsg(`Only captured ${newSamples.length}/${SAMPLES_PER_POSE}. Retry or continue.`)
    } else if (currentPoseIndex < POSES.length - 1) {
      const next = currentPoseIndex + 1
      setCurrentPoseIndex(next)
      setStatusMsg(POSES[next]?.label ?? "")
    } else {
      setCurrentPoseIndex(POSES.length)
      setStatusMsg("All poses captured! Click Submit to enroll.")
    }

    setCapturing(false)
  }

  async function handleSubmit(): Promise<void> {
    if (samples.length < 3) return
    setSubmitStatus("submitting")
    setSubmitError(null)

    try {
      const res = await fetch("/api/face/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId, samples }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Enrollment failed")
      setSubmitStatus("done")
      stopCamera()
    } catch (e) {
      setSubmitStatus("error")
      setSubmitError(e instanceof Error ? e.message : "Enrollment failed")
    }
  }

  function resetEnrollment(): void {
    setSamples([])
    setCurrentPoseIndex(0)
    setSubmitStatus("idle")
    setSubmitError(null)
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d")
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    }
    if (cameraActive) setStatusMsg(POSES[0]?.label ?? "")
  }

  const allPosesDone = currentPoseIndex >= POSES.length && samples.length >= TOTAL_SAMPLES - 2
  const progressPct = Math.min(100, Math.round((samples.length / TOTAL_SAMPLES) * 100))

  return (
    <PageShell title="Face Enrollment">
      {loadError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 font-medium">
          {loadError}
        </div>
      )}

      {submitStatus === "done" ? (
        <div className="flex flex-col items-center gap-6 py-6">
          <CheckCircle className="text-emerald-500" size={64} />
          <div className="text-center">
            <p className="text-2xl font-black text-slate-900 mb-2">Enrollment Complete</p>
            <p className="text-slate-500">{samples.length} samples captured across {POSES.length} poses.</p>
            <p className="text-sm text-slate-400 mt-1">This face profile is now active in the attendance kiosk.</p>
          </div>
          <div className="flex gap-4">
            <Button variant="primary" onClick={() => router.push("/staff")}>Back to Staff</Button>
            <Button variant="secondary" onClick={() => { resetEnrollment(); startCamera() }}>Re-enroll</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Camera */}
          <div>
            <div className="relative rounded-2xl overflow-hidden bg-slate-900 aspect-[4/3] shadow-xl">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                muted
                playsInline
                style={{ transform: "scaleX(-1)" }}
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full"
                style={{ transform: "scaleX(-1)" }}
              />
              {!cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                  <Camera className="text-slate-400" size={48} />
                  <p className="text-slate-400 text-sm">Camera off</p>
                </div>
              )}
              {cameraActive && statusMsg && (
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
                  <p className="text-white text-sm font-semibold text-center">{statusMsg}</p>
                </div>
              )}
            </div>

            <div className="mt-4 flex gap-3">
              {!cameraActive ? (
                <Button
                  variant="primary"
                  className="flex-1 flex items-center gap-2"
                  disabled={!modelsLoaded || !!loadError}
                  onClick={startCamera}
                >
                  <Camera size={16} /> Start Camera
                </Button>
              ) : (
                <Button variant="secondary" className="flex-1" onClick={stopCamera}>
                  Stop Camera
                </Button>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-5">
            {/* Existing profile */}
            {staff?.faceProfile?.enrolledAt && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-bold text-amber-800">Existing enrollment found</p>
                <p className="text-xs text-amber-600 mt-1">
                  Enrolled {new Date(staff.faceProfile.enrolledAt).toLocaleDateString()} · {staff.faceProfile.sampleCount} samples
                </p>
                <p className="text-xs text-amber-600">Submitting new samples will overwrite the existing profile.</p>
              </div>
            )}

            {/* Pose guide */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-4">Capture Progress</p>
              <div className="mb-4">
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-600">{samples.length} / {TOTAL_SAMPLES} samples</span>
                  <span className="font-bold text-indigo-600">{progressPct}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              <div className="space-y-2 mb-5">
                {POSES.map((p, i) => {
                  const poseCount = samples.filter((s) => s.pose === p.key).length
                  const done = poseCount >= SAMPLES_PER_POSE
                  const active = i === currentPoseIndex && !allPosesDone
                  return (
                    <div
                      key={p.key}
                      className={`flex items-center gap-3 rounded-lg p-3 ${
                        active ? "bg-indigo-50 border border-indigo-200" :
                        done ? "bg-emerald-50 border border-emerald-200" :
                        "bg-slate-50 border border-slate-100"
                      }`}
                    >
                      <span className={`text-xl ${active ? "animate-bounce" : ""}`}>
                        {done ? "✅" : active ? "📸" : "⬜"}
                      </span>
                      <div className="flex-1">
                        <p className={`text-sm font-bold ${active ? "text-indigo-700" : done ? "text-emerald-700" : "text-slate-500"}`}>
                          {p.label}
                        </p>
                        <p className="text-xs text-slate-400">{poseCount}/{SAMPLES_PER_POSE} frames</p>
                      </div>
                    </div>
                  )
                })}
              </div>

              {!allPosesDone ? (
                <Button
                  variant="primary"
                  className="w-full flex items-center justify-center gap-2"
                  disabled={!cameraActive || capturing || submitStatus === "submitting"}
                  onClick={captureFrames}
                >
                  {capturing ? (
                    <><RefreshCw size={14} className="animate-spin" /> Capturing…</>
                  ) : (
                    <><Camera size={14} /> Capture {POSES[currentPoseIndex]?.label ?? "Pose"}</>
                  )}
                </Button>
              ) : (
                <div className="space-y-3">
                  {submitStatus === "error" && (
                    <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                      <XCircle size={14} /> {submitError}
                    </div>
                  )}
                  <Button
                    variant="primary"
                    className="w-full"
                    disabled={submitStatus === "submitting"}
                    onClick={handleSubmit}
                  >
                    {submitStatus === "submitting" ? "Enrolling…" : `Submit ${samples.length} Samples`}
                  </Button>
                  <Button variant="secondary" className="w-full" onClick={resetEnrollment}>
                    Start Over
                  </Button>
                </div>
              )}
            </div>

            {/* Tips */}
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Tips for accurate enrollment</p>
              <ul className="text-xs text-slate-500 space-y-1">
                <li>• Good lighting — face the light source</li>
                <li>• Remove glasses if possible</li>
                <li>• Keep face within the camera frame</li>
                <li>• Natural expression — no exaggerated faces</li>
                <li>• Hold each pose steady for 1–2 seconds</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
