"use client"

import { useEffect, useState } from "react"
import * as faceapi from "face-api.js"
import { nanoid } from "nanoid"

import { Button } from "@/components/ui/Button"
import { PageShell } from "@/components/PageShell"

type Staff = { id: number; name: string; role: string }
type AttendanceEvent = {
  id: number
  staff: { name: string; role: string }
  eventType: string
  method: string
  occurredAt: string
  isLate: boolean
  isEarlyDeparture: boolean
}

type FaceProfile = {
  staffId: number
  staffName: string
  staffRole: string
  threshold: number
  sampleCount: number
  descriptor: number[] | null
}

export default function AttendancePage(): JSX.Element {
  const [staff, setStaff] = useState<Staff[]>([])
  const [events, setEvents] = useState<AttendanceEvent[]>([])
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null)
  const [processing, setProcessing] = useState(false)
  const [lastResult, setLastResult] = useState<{ message: string; ok: boolean } | null>(null)
  const [mode, setMode] = useState<"PIN" | "FACE">("PIN")

  const [faceReady, setFaceReady] = useState(false)
  const [faceStatus, setFaceStatus] = useState<string>("")
  const [faceProfiles, setFaceProfiles] = useState<FaceProfile[]>([])
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const [blinked, setBlinked] = useState(false)

  useEffect(() => {
    fetch("/api/staff").then((r) => r.json()).then((data) => {
      setStaff(Array.isArray(data) ? data : [])
    }).catch(() => {})

    fetchEvents()
    const interval = setInterval(fetchEvents, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (mode !== "FACE") return
    let cancelled = false

    async function setup(): Promise<void> {
      try {
        setFaceStatus("Loading face models…")
        await faceapi.nets.tinyFaceDetector.loadFromUri("/models")
        await faceapi.nets.faceLandmark68TinyNet.loadFromUri("/models")
        await faceapi.nets.faceRecognitionNet.loadFromUri("/models")
        if (cancelled) return

        setFaceStatus("Fetching enrolled staff…")
        const res = await fetch("/api/face/profiles")
        const data = await res.json()
        setFaceProfiles(Array.isArray(data) ? data : [])
        if (cancelled) return

        setFaceReady(true)
        setFaceStatus("Ready. Look at the camera and blink once.")
      } catch {
        setFaceReady(false)
        setFaceStatus("Face system not ready. Run `npm run setup:face-models` and refresh.")
      }
    }

    setup()
    return () => { cancelled = true }
  }, [mode])

  async function fetchEvents(): Promise<void> {
    try {
      const res = await fetch("/api/attendance")
      const data = await res.json()
      if (Array.isArray(data)) setEvents(data)
    } catch { /* silent */ }
  }

  async function handlePunch(): Promise<void> {
    if (!selectedStaffId) return
    setProcessing(true)
    setLastResult(null)

    const res = await fetch("/api/attendance/punch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staffId: selectedStaffId,
        method: "PIN",
        requestId: nanoid(),
        deviceLabel: "ATTENDANCE_KIOSK",
      }),
    })

    setProcessing(false)
    if (res.ok) {
      const data = await res.json()
      setLastResult({ message: data.message, ok: !data.isLate && !data.isEarlyDeparture })
      setSelectedStaffId(null)
      fetchEvents()
    } else {
      const err = await res.json()
      setLastResult({ message: err.error ?? "Punch failed", ok: false })
    }

    setTimeout(() => setLastResult(null), 5000)
  }

  function euclideanDistance(a: Float32Array, b: number[]): number {
    let sum = 0
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - (b[i] ?? 0)
      sum += d * d
    }
    return Math.sqrt(sum)
  }

  function eyeAspectRatio(pts: faceapi.Point[]): number {
    // EAR = (||p2-p6|| + ||p3-p5||) / (2*||p1-p4||)
    const dist = (p: faceapi.Point, q: faceapi.Point) => Math.hypot(p.x - q.x, p.y - q.y)
    const p1 = pts[0], p2 = pts[1], p3 = pts[2], p4 = pts[3], p5 = pts[4], p6 = pts[5]
    return (dist(p2, p6) + dist(p3, p5)) / (2 * dist(p1, p4))
  }

  async function startFaceScan(): Promise<void> {
    if (!faceReady || !videoEl) return
    setProcessing(true)
    setLastResult(null)
    setBlinked(false)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
      videoEl.srcObject = stream
      await videoEl.play()

      setFaceStatus("Scanning… (blink to prove liveness)")
      const detectorOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })

      const started = Date.now()
      let sawEyesOpen = false

      while (Date.now() - started < 10_000) {
        const det = await faceapi
          .detectSingleFace(videoEl, detectorOptions)
          .withFaceLandmarks(true)
          .withFaceDescriptor()

        if (!det) {
          setFaceStatus("No face detected. Center your face and increase light.")
          await new Promise((r) => setTimeout(r, 250))
          continue
        }

        const leftEye = det.landmarks.getLeftEye()
        const rightEye = det.landmarks.getRightEye()
        const ear = (eyeAspectRatio(leftEye) + eyeAspectRatio(rightEye)) / 2

        if (ear > 0.23) sawEyesOpen = true
        if (sawEyesOpen && ear < 0.18) {
          setBlinked(true)
          setFaceStatus("Liveness OK. Matching…")
        }

        if (!blinked && !sawEyesOpen) {
          setFaceStatus("Look at camera (eyes open)…")
        } else if (!blinked) {
          setFaceStatus("Blink once to continue…")
        }

        if (!blinked) {
          await new Promise((r) => setTimeout(r, 120))
          continue
        }

        const candidates = faceProfiles
          .filter((p) => Array.isArray(p.descriptor) && p.descriptor.length > 0)
          .map((p) => ({
            profile: p,
            dist: euclideanDistance(det.descriptor, p.descriptor as number[]),
          }))
          .sort((a, b) => a.dist - b.dist)

        const best = candidates[0]
        const second = candidates[1]
        if (!best) throw new Error("No enrolled faces")

        const margin = second ? (second.dist - best.dist) : 999
        const threshold = Math.min(0.6, Math.max(0.35, best.profile.threshold ?? 0.48))

        // Reliability rule: must be under threshold AND clearly better than #2
        if (best.dist > threshold || margin < 0.06) {
          setFaceStatus("Face not confident. Adjust angle/light and try again.")
          await new Promise((r) => setTimeout(r, 350))
          continue
        }

        const confidence = Math.max(0, Math.min(1, 1 - (best.dist / threshold)))
        const punchRes = await fetch("/api/attendance/punch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            staffId: best.profile.staffId,
            method: "FACE",
            confidenceScore: confidence,
            requestId: nanoid(),
            deviceLabel: "ATTENDANCE_KIOSK",
          }),
        })

        const data = await punchRes.json()
        if (punchRes.ok) {
          setLastResult({ message: `${best.profile.staffName}: ${data.message}`, ok: !data.isLate && !data.isEarlyDeparture })
          fetchEvents()
          break
        } else {
          setLastResult({ message: data.error ?? "Punch failed", ok: false })
          break
        }
      }
    } catch {
      setLastResult({ message: "Camera/face scan failed", ok: false })
    } finally {
      setProcessing(false)
      try {
        const stream = videoEl?.srcObject as MediaStream | null
        stream?.getTracks().forEach((t) => t.stop())
      } catch { /* ignore */ }
      if (videoEl) videoEl.srcObject = null
      setTimeout(() => setLastResult(null), 5000)
    }
  }

  return (
    <PageShell title="Attendance Kiosk" subtitle="Clock in / out by selecting staff and confirming.">
      <div className="grid grid-cols-3 gap-6">
        {/* Punch panel */}
        <div className="col-span-1 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="mb-4 text-sm font-semibold text-slate-200">Clock In / Out</h3>

          {lastResult && (
            <div className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium ${lastResult.ok ? "bg-emerald-900/50 text-emerald-300" : "bg-amber-900/50 text-amber-300"}`}>
              {lastResult.message}
            </div>
          )}

          <div className="mb-4 flex gap-2">
            <button
              className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold ${mode === "PIN" ? "border-emerald-700 bg-emerald-900/30 text-emerald-200" : "border-slate-700 bg-slate-900/20 text-slate-300"}`}
              onClick={() => setMode("PIN")}
              disabled={processing}
            >
              PIN
            </button>
            <button
              className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold ${mode === "FACE" ? "border-emerald-700 bg-emerald-900/30 text-emerald-200" : "border-slate-700 bg-slate-900/20 text-slate-300"}`}
              onClick={() => setMode("FACE")}
              disabled={processing}
            >
              FACE
            </button>
          </div>

          {mode === "FACE" ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">Status</p>
                <p className="mt-1 text-sm text-slate-200">{faceStatus || "—"}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Enrolled: {faceProfiles.filter((p) => Array.isArray(p.descriptor) && (p.descriptor?.length ?? 0) > 0).length}
                </p>
              </div>

              <video
                ref={(el) => setVideoEl(el)}
                className="aspect-video w-full rounded-lg border border-slate-800 bg-black"
                muted
                playsInline
              />

              <Button
                variant="primary"
                className="w-full"
                onClick={startFaceScan}
                disabled={!faceReady || processing}
              >
                {processing ? "Scanning…" : "Scan & Punch"}
              </Button>
            </div>
          ) : (
            <>
          <div className="mb-4">
            <label className="mb-1 block text-xs text-slate-400">Select Staff</label>
            <select
              value={selectedStaffId ?? ""}
              onChange={(e) => setSelectedStaffId(e.target.value ? parseInt(e.target.value, 10) : null)}
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">Select staff member…</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
              ))}
            </select>
          </div>

          <Button
            variant="primary"
            className="w-full"
            onClick={handlePunch}
            disabled={!selectedStaffId || processing}
          >
            {processing ? "Processing…" : "Punch In/Out"}
          </Button>
            </>
          )}
        </div>

        {/* Today's log */}
        <div className="col-span-2 rounded-lg border border-slate-800">
          <div className="border-b border-slate-800 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-200">Today{"'"}s Log</h3>
          </div>
          {events.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">No attendance events today.</p>
          ) : (
            <div className="divide-y divide-slate-800">
              {events.map((event) => (
                <div key={event.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-100">{event.staff.name}</p>
                    <p className="text-xs text-slate-400">{event.staff.role}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {event.isLate && (
                      <span className="rounded-full bg-amber-900/50 px-2 py-0.5 text-xs text-amber-300">LATE</span>
                    )}
                    {event.isEarlyDeparture && (
                      <span className="rounded-full bg-orange-900/50 px-2 py-0.5 text-xs text-orange-300">EARLY</span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${event.eventType === "CLOCK_IN" ? "bg-emerald-900/50 text-emerald-300" : "bg-blue-900/50 text-blue-300"}`}>
                      {event.eventType.replace("_", " ")}
                    </span>
                    <span className="text-xs text-slate-400">
                      {new Date(event.occurredAt).toLocaleTimeString("en-IN")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
}
