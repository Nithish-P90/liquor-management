"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import * as faceapi from "face-api.js"
import { nanoid } from "nanoid"
import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"
import { UserCheck, UserX, Clock, Loader2, Camera, Shield, UserRoundCheck, UserRoundX, ChevronDown, Sparkles, CircleCheckBig, ShieldAlert, Play, StopCircle, ScanFace } from "lucide-react"

type StaffRow = { id: number; name: string; role: string; faceEnrolled: boolean; faceSampleCount: number }

type DayAttendanceState = {
  hasClockIn: boolean
  hasClockOut: boolean
  lastEventType: "CLOCK_IN" | "CLOCK_OUT" | null
  lastEventTime: string | null
}

type RosterEntry = {
  staffId: number
  name: string
  role: string
  status: "IN" | "OUT" | "ABSENT"
  isLate: boolean
  time: string | null  // last event time
}

type FaceProfile = {
  staffId: number
  staffName: string
  staffRole: string
  threshold: number
  sampleCount: number
  descriptor: number[] | null
}

type ScanState = "loading" | "ready" | "scanning" | "error"

type DetectionMode = "HIGH_ACCURACY" | "FAST"

function euclideanDist(a: Float32Array, b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) { const d = a[i] - (b[i] ?? 0); s += d * d }
  return Math.sqrt(s)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function confidenceFromDistance(distance: number, threshold: number): number {
  if (threshold <= 0) return 0
  return clamp(1 - distance / threshold, 0, 1)
}

function faceCoverage(video: HTMLVideoElement, box?: { width: number; height: number } | null): number {
  if (!box) return 0
  const frameArea = video.videoWidth * video.videoHeight
  if (frameArea <= 0) return 0
  return (box.width * box.height) / frameArea
}

function pickBestDetection<T extends { detection: { score: number; box: { width: number; height: number } } }>(detections: T[]): T | null {
  let best: T | null = null
  let bestScore = -Infinity
  for (const detection of detections) {
    const area = detection.detection.box.width * detection.detection.box.height
    const score = detection.detection.score * 0.75 + area * 0.00001
    if (score > bestScore) {
      bestScore = score
      best = detection
    }
  }
  return best
}

export default function AttendancePage(): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const profilesRef = useRef<FaceProfile[]>([])
  const scanningRef = useRef(false)
  const mountedRef = useRef(true)

  const [scanState, setScanState] = useState<ScanState>("loading")
  const [statusMsg, setStatusMsg] = useState("Loading face recognition models…")
  const [lastResult, setLastResult] = useState<{ name: string; msg: string; ok: boolean } | null>(null)
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [dayState, setDayState] = useState<Record<number, DayAttendanceState>>({})
  const [staffOptions, setStaffOptions] = useState<StaffRow[]>([])
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null)
  const [selectedFaceMatch, setSelectedFaceMatch] = useState<{ confidence: number } | null>(null)
  const [matchStreak, setMatchStreak] = useState(0)
  const [enrolledCount, setEnrolledCount] = useState(0)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [captureActive, setCaptureActive] = useState(false)
  const [detectionMode, setDetectionMode] = useState<DetectionMode>("HIGH_ACCURACY")
  const [isAdmin, setIsAdmin] = useState(false)
  const [loadingAction, setLoadingAction] = useState<"CLOCK_IN" | "CLOCK_OUT" | null>(null)
  const [manualReason, setManualReason] = useState("")

  // ── Load models, profile list, and session role on mount ───────────────────
  useEffect(() => {
    mountedRef.current = true

    async function init(): Promise<void> {
      try {
        setStatusMsg("Loading face models…")
        // Prefer high-accuracy detection for the kiosk; fall back to the tiny
        // detector only if the larger model set is unavailable.
        try {
          await faceapi.nets.ssdMobilenetv1.loadFromUri("/models")
          await faceapi.nets.faceLandmark68Net.loadFromUri("/models")
          setDetectionMode("HIGH_ACCURACY")
        } catch {
          await faceapi.nets.tinyFaceDetector.loadFromUri("/models")
          await faceapi.nets.faceLandmark68TinyNet.loadFromUri("/models")
          setDetectionMode("FAST")
        }
        await faceapi.nets.faceRecognitionNet.loadFromUri("/models")

        const [sessionRes, profilesRes] = await Promise.all([
          fetch("/api/auth/session"),
          fetch("/api/face/profiles"),
        ])

        const session = await sessionRes.json().catch(() => null) as { user?: { role?: string } } | null
        if (mountedRef.current) {
          setIsAdmin(session?.user?.role === "ADMIN")
        }

        const data: FaceProfile[] = await profilesRes.json()
        if (mountedRef.current) {
          profilesRef.current = Array.isArray(data) ? data.filter((p) => Array.isArray(p.descriptor) && p.descriptor.length > 0) : []
          setEnrolledCount(profilesRef.current.length)
        }

        if (!mountedRef.current) return
        setModelsLoaded(true)
        setScanState("ready")
        setStatusMsg("Select a staff member, then start live verification.")
      } catch (e) {
        if (!mountedRef.current) return
        setScanState("error")
        setStatusMsg(e instanceof Error && e.message.includes("camera")
          ? "Camera permission denied. Allow camera access and refresh."
          : "Models not found. Run: npm run setup:face-models")
      }
    }

    init()
    return () => {
      mountedRef.current = false
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // ── Fetch roster (today's events → build present/absent map) ──────────────
  const fetchRoster = useCallback(async () => {
    try {
      const [eventsRes, staffRes] = await Promise.all([
        fetch("/api/attendance"),
        fetch("/api/staff"),
      ])
      const events: Array<{ staffId: number; staff: { name: string; role: string }; eventType: "CLOCK_IN" | "CLOCK_OUT"; occurredAt: string; isLate: boolean }> = await eventsRes.json()
      const staff: StaffRow[] = await staffRes.json()

      if (!mountedRef.current) return

      // Today's last event per staff, preserving newest-first order from the API.
      const lastEvent = new Map<number, { status: "IN" | "OUT"; isLate: boolean; time: string }>()
      const stateByStaff: Record<number, DayAttendanceState> = {}
      for (const ev of events) {
        if (!stateByStaff[ev.staffId]) {
          stateByStaff[ev.staffId] = {
            hasClockIn: ev.eventType === "CLOCK_IN",
            hasClockOut: ev.eventType === "CLOCK_OUT",
            lastEventType: ev.eventType,
            lastEventTime: ev.occurredAt,
          }
        } else {
          stateByStaff[ev.staffId].hasClockIn ||= ev.eventType === "CLOCK_IN"
          stateByStaff[ev.staffId].hasClockOut ||= ev.eventType === "CLOCK_OUT"
        }

        if (!lastEvent.has(ev.staffId)) {
          lastEvent.set(ev.staffId, {
            status: ev.eventType === "CLOCK_IN" ? "IN" : "OUT",
            isLate: ev.isLate,
            time: ev.occurredAt,
          })
        }
      }

      const entries: RosterEntry[] = staff.map((s) => {
        const ev = lastEvent.get(s.id)
        return {
          staffId: s.id,
          name: s.name,
          role: s.role,
          status: ev?.status ?? "ABSENT",
          isLate: ev?.isLate ?? false,
          time: ev?.time ?? null,
        }
      })

      // Sort: IN first, then OUT, then ABSENT; within group alphabetically
      entries.sort((a, b) => {
        const order = { IN: 0, OUT: 1, ABSENT: 2 }
        return (order[a.status] - order[b.status]) || a.name.localeCompare(b.name)
      })

      setRoster(entries)
      setDayState(stateByStaff)
      setStaffOptions(staff)
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    fetchRoster()
    const iv = setInterval(fetchRoster, 15_000)
    return () => clearInterval(iv)
  }, [fetchRoster])

  const selectedStaff = selectedStaffId != null ? staffOptions.find((staff) => staff.id === selectedStaffId) ?? null : null
  const selectedStaffName = selectedStaff?.name ?? null
  const selectedProfile = selectedStaffId != null ? profilesRef.current.find((profile) => profile.staffId === selectedStaffId) ?? null : null
  const selectedDayStatus = selectedStaffId != null ? dayState[selectedStaffId] ?? null : null
  const canStartCapture = !!selectedStaffId && !!selectedProfile && modelsLoaded && !cameraActive

  useEffect(() => {
    if (selectedStaffId == null) {
      setSelectedFaceMatch(null)
      setMatchStreak(0)
      return
    }
    setSelectedFaceMatch(null)
    setMatchStreak(0)
    setCaptureActive(false)
    setStatusMsg(modelsLoaded ? "Ready to verify the selected staff member." : "Loading face models…")
  }, [modelsLoaded, selectedStaffId, selectedStaffName])

  const canClockIn = !selectedDayStatus?.hasClockIn && !selectedDayStatus?.hasClockOut
  const canClockOut = !!selectedDayStatus?.hasClockIn && !selectedDayStatus?.hasClockOut

  const startCamera = useCallback(async (): Promise<void> => {
    if (!selectedStaffId || !modelsLoaded || cameraActive) return
    const profile = selectedProfile
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
      if (mountedRef.current) {
        setCameraActive(true)
        setCaptureActive(true)
        setStatusMsg(profile ? `Camera ready for ${profile.staffName}. Hold still for a live face match.` : "Selected staff has no enrolled face profile.")
      }
    } catch (e) {
      if (!mountedRef.current) return
      setScanState("error")
      setStatusMsg(e instanceof Error && e.message.includes("camera")
        ? "Camera permission denied. Allow camera access and refresh."
        : "Camera failed to start.")
    }
  }, [cameraActive, modelsLoaded, selectedProfile, selectedStaffId])

  function stopCamera(): void {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraActive(false)
    setCaptureActive(false)
    setMatchStreak(0)
  }

  useEffect(() => {
    if (!modelsLoaded || selectedStaffId == null) return
    if (captureActive && !cameraActive) {
      void startCamera()
    }
  }, [captureActive, cameraActive, modelsLoaded, selectedStaffId, startCamera])

  async function submitPunch(eventType: "CLOCK_IN" | "CLOCK_OUT", method: "FACE" | "MANUAL_OVERRIDE", confidenceScore?: number): Promise<void> {
    if (!selectedStaffId) return
    setLoadingAction(eventType)
    try {
      const res = await fetch("/api/attendance/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: selectedStaffId,
          method,
          eventType,
          confidenceScore,
          requestId: nanoid(),
          deviceLabel: method === "FACE" ? "ATTENDANCE_KIOSK" : "ADMIN_MANUAL",
          overrideReason: method === "MANUAL_OVERRIDE" ? manualReason.trim() || undefined : undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Punch failed")

      const ok = !data.isLate && !data.isEarlyDeparture
      setLastResult({ name: selectedStaff?.name ?? data.message, msg: data.message, ok })
      setStatusMsg(`${selectedStaff?.name ?? "Staff"} — ${data.message}`)
      setManualReason("")
      fetchRoster()
      setTimeout(() => { if (mountedRef.current) setLastResult(null) }, 5000)
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : "Punch failed. Try again.")
    } finally {
      setLoadingAction(null)
    }
  }

  // ── Continuous face scan loop ─────────────────────────────────────────────
  useEffect(() => {
    if (scanState !== "ready" || !cameraActive || !captureActive || !selectedProfile) return

    let cancelled = false
    scanningRef.current = true

    async function loop(): Promise<void> {
      const tinyOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 640, scoreThreshold: 0.55 })
      const ssdOpts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.72 })

      while (!cancelled) {
        const video = videoRef.current
        if (!video || video.readyState < 2) {
          await delay(200)
          continue
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let det: any = null
        try {
          const raw = detectionMode === "HIGH_ACCURACY"
            ? await faceapi.detectAllFaces(video, ssdOpts).withFaceLandmarks().withFaceDescriptors()
            : await faceapi.detectAllFaces(video, tinyOpts).withFaceLandmarks(true).withFaceDescriptors()
          det = pickBestDetection(raw ?? [])
        } catch { /* continue */ }

        if (!det) {
          setStatusMsg("No face detected. Keep the selected staff member in frame.")
          setMatchStreak(0)
          await delay(200)
          continue
        }

        const profile = selectedProfile
        if (!profile || !profile.descriptor || profile.descriptor.length === 0) {
          setStatusMsg(`${selectedStaffName ?? "Selected staff"} has no enrolled face profile.`)
          await delay(1500)
          continue
        }

        const faceBox = det.detection?.box
        const coverage = faceCoverage(video, faceBox)

        if (coverage < 0.05) {
          setMatchStreak(0)
          setSelectedFaceMatch(null)
          setStatusMsg("Move closer so the face fills more of the frame.")
          await delay(250)
          continue
        }

        setStatusMsg(`Matching ${profile.staffName}…`)

        const threshold = Math.min(0.54, Math.max(0.34, profile.threshold))
        const dist = euclideanDist(det!.descriptor, profile.descriptor as number[])
        const confidence = confidenceFromDistance(dist, threshold)

        if (dist > threshold) {
          setSelectedFaceMatch(null)
          setMatchStreak(0)
          setStatusMsg("Face mismatch. Keep the selected staff member in view.")
          await delay(1200)
          continue
        }

        const nextStreak = matchStreak + 1
        setMatchStreak(nextStreak)
        setSelectedFaceMatch({ confidence })
        setStatusMsg(`Matched ${profile.staffName}. Hold steady to confirm.`)
        if (nextStreak >= 3 && confidence >= 0.7) {
          setStatusMsg(`Confirmed ${profile.staffName}. Choose check in or check out.`)
        }
        await delay(1000)
      }
    }

    loop()
    return () => { cancelled = true; scanningRef.current = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraActive, fetchRoster, scanState, selectedProfile, selectedStaffName])

  const presentCount = useMemo(() => roster.filter((r) => r.status === "IN").length, [roster])
  const absentCount = useMemo(() => roster.filter((r) => r.status === "ABSENT").length, [roster])
  const outCount = useMemo(() => roster.filter((r) => r.status === "OUT").length, [roster])
  const matchReady = !!selectedFaceMatch && matchStreak >= 3 && selectedFaceMatch.confidence >= 0.7

  return (
    <PageShell title="Attendance Kiosk" subtitle="Fast face verification for clock in and clock out.">
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-10 items-start">

        {/* ── Camera Panel ── */}
        <div className="lg:col-span-3 space-y-6">
          <div className="rounded-[2.5rem] border-2 border-slate-100 bg-white p-8 shadow-sm">
              <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div className="flex-1">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3 px-1">Step 1 · Select identity</p>
                <div className="relative group">
                  <UserRoundCheck className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={20} />
                  <select
                    value={selectedStaffId ?? ""}
                    onChange={(e) => {
                      const next = e.target.value ? Number(e.target.value) : null
                      setSelectedStaffId(next)
                      setSelectedFaceMatch(null)
                      if (!next) stopCamera()
                    }}
                    className="w-full appearance-none rounded-2xl border-2 border-slate-100 bg-slate-50 pl-14 pr-12 py-5 text-lg font-black text-slate-800 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all cursor-pointer shadow-inner"
                  >
                    <option value="">Select identity from roster…</option>
                    {staffOptions.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name} · {staff.role}{staff.faceEnrolled ? ` · Profile Active (${staff.faceSampleCount} Samples)` : " · Biometric Pending"}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={20} />
                </div>
              </div>
              <div className="flex flex-col gap-3 md:min-w-[260px]">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-600">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <ScanFace size={16} className="text-indigo-500" />
                    {detectionMode === "HIGH_ACCURACY" ? "High accuracy detection" : "Fast detection"}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    Choose a person first, then start the camera. The kiosk will confirm the face over multiple frames before enabling actions.
                  </p>
                  {selectedStaffId && !selectedProfile && (
                    <p className="mt-2 text-xs font-semibold text-amber-600">
                      This staff member has no face profile yet. Ask an admin to enroll their face.
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="primary"
                    className="w-full justify-center gap-2 py-4 font-black uppercase tracking-[0.12em]"
                    disabled={!canStartCapture}
                    onClick={() => void startCamera()}
                  >
                    <Play size={15} /> Start camera
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-full justify-center gap-2 py-4 font-black uppercase tracking-[0.12em]"
                    disabled={!cameraActive}
                    onClick={stopCamera}
                  >
                    <StopCircle size={15} /> Stop
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Video */}
          <div className="relative rounded-[3rem] overflow-hidden bg-slate-900 shadow-2xl aspect-[4/3] border-4 border-white ring-8 ring-slate-100">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              muted
              playsInline
              style={{ transform: "scaleX(-1)" }}
            />

            {/* Overlay: loading / error state */}
            {scanState === "loading" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/80">
                <Loader2 className="text-indigo-400 animate-spin" size={40} />
                <p className="text-slate-300 text-sm font-medium">{statusMsg}</p>
              </div>
            )}
            {scanState === "error" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/90 p-6 text-center">
                <p className="text-rose-400 text-base font-bold">Setup Required</p>
                <p className="text-slate-400 text-sm">{statusMsg}</p>
              </div>
            )}
            {!cameraActive && scanState !== "error" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/80 text-center p-6">
                <Camera className="text-slate-400" size={42} />
                <p className="text-slate-300 text-sm font-semibold">Select a staff member, then press Start camera.</p>
              </div>
            )}

            {/* Status bar */}
            {scanState === "ready" && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent px-8 pb-8 pt-16">
                <p className="text-white text-base font-black text-center tracking-[0.1em] uppercase">{statusMsg}</p>
              </div>
            )}

            {/* Enrolled badge */}
            <div className="absolute top-3 right-3 rounded-full bg-black/50 backdrop-blur-sm px-3 py-1.5 text-xs font-bold text-slate-200">
              {enrolledCount} enrolled
            </div>
          </div>

          {/* Result flash */}
          {lastResult && (
            <div className={`rounded-2xl p-5 text-center shadow-lg transition-all ${
              lastResult.ok
                ? "bg-emerald-500/10 border border-emerald-400/30"
                : "bg-amber-500/10 border border-amber-400/30"
            }`}>
              <p className={`text-2xl font-black mb-1 ${lastResult.ok ? "text-emerald-600" : "text-amber-600"}`}>
                {lastResult.name}
              </p>
              <p className={`text-sm font-semibold ${lastResult.ok ? "text-emerald-700" : "text-amber-700"}`}>
                {lastResult.msg}
              </p>
            </div>
          )}

          {selectedStaff && (
            <div className="rounded-2xl border-2 border-slate-100 bg-white p-6 shadow-md space-y-5 transition-all animate-in slide-in-from-bottom-2">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between border-b-2 border-slate-50 pb-5">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Selected staff</p>
                  <p className="text-2xl font-black text-slate-900 leading-tight">{selectedStaff.name}</p>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">{selectedStaff.role}</p>
                </div>
                <div className="text-right text-sm font-black text-slate-500 bg-slate-50 px-4 py-2 rounded-xl">
                    {selectedDayStatus?.hasClockIn ? (selectedDayStatus.hasClockOut ? "FINISHED TODAY" : "CURRENTLY ON DUTY") : "NOT MARKED YET"}
                </div>
              </div>

              <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${matchReady ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                {matchReady ? (
                  <span className="flex items-center gap-2"><CircleCheckBig size={15} /> Face confirmed. Actions unlocked.</span>
                ) : selectedFaceMatch ? (
                  <span className="flex items-center gap-2"><Sparkles size={15} /> Matching… hold steady to confirm the face.</span>
                ) : (
                  <span className="flex items-center gap-2"><ShieldAlert size={15} /> No confirmed match yet.</span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Button
                  variant="primary"
                  className="w-full justify-center gap-3 py-5 text-lg font-black uppercase tracking-[0.15em] shadow-lg shadow-emerald-900/10 active:scale-95 transition-all"
                  disabled={!matchReady || !canClockIn || loadingAction !== null}
                  onClick={() => void submitPunch("CLOCK_IN", "FACE", selectedFaceMatch?.confidence)}
                >
                  <UserRoundCheck size={24} /> {loadingAction === "CLOCK_IN" ? "Syncing…" : "Check In"}
                </Button>
                <Button
                  variant="secondary"
                  className="w-full justify-center gap-3 py-5 text-lg font-black uppercase tracking-[0.15em] shadow-lg border-2 border-slate-200 active:scale-95 transition-all"
                  disabled={!matchReady || !canClockOut || loadingAction !== null}
                  onClick={() => void submitPunch("CLOCK_OUT", "FACE", selectedFaceMatch?.confidence)}
                >
                  <UserRoundX size={24} /> {loadingAction === "CLOCK_OUT" ? "Syncing…" : "Check Out"}
                </Button>
              </div>

              {selectedFaceMatch && (
                <p className="text-sm font-semibold text-emerald-700 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
                  Confidence {(selectedFaceMatch.confidence * 100).toFixed(0)}% · streak {matchStreak}/3.
                </p>
              )}

              {isAdmin && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500">
                    <Shield size={13} /> Admin manual mark
                  </div>
                  <input
                    value={manualReason}
                    onChange={(e) => setManualReason(e.target.value)}
                    placeholder="Optional reason for manual override"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-indigo-500 focus:outline-none"
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Button
                      variant="primary"
                      className="w-full justify-center gap-2"
                      disabled={!selectedStaff || !canClockIn || loadingAction !== null}
                      onClick={() => void submitPunch("CLOCK_IN", "MANUAL_OVERRIDE")}
                    >
                      <UserRoundCheck size={15} /> {loadingAction === "CLOCK_IN" ? "Marking…" : "Manual Check In"}
                    </Button>
                    <Button
                      variant="secondary"
                      className="w-full justify-center gap-2"
                      disabled={!selectedStaff || !canClockOut || loadingAction !== null}
                      onClick={() => void submitPunch("CLOCK_OUT", "MANUAL_OVERRIDE")}
                    >
                      <UserRoundX size={15} /> {loadingAction === "CLOCK_OUT" ? "Marking…" : "Manual Check Out"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Stats bar */}
          <div className="grid grid-cols-3 gap-6">
            <div className="rounded-[2rem] border-2 border-emerald-100 bg-emerald-50 p-8 text-center shadow-sm">
              <p className="text-5xl font-black text-emerald-700 tracking-tighter tabular-nums">{presentCount}</p>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500 mt-3">Active Duty</p>
            </div>
            <div className="rounded-[2rem] border-2 border-slate-100 bg-slate-50 p-8 text-center shadow-sm">
              <p className="text-5xl font-black text-slate-600 tracking-tighter tabular-nums">{outCount}</p>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mt-3">Released</p>
            </div>
            <div className="rounded-[2rem] border-2 border-rose-100 bg-rose-50 p-8 text-center shadow-sm">
              <p className="text-5xl font-black text-rose-600 tracking-tighter tabular-nums">{absentCount}</p>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-400 mt-3">Pending</p>
            </div>
          </div>
        </div>

        {/* ── Roster Panel ── */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl border-2 border-slate-100 bg-white shadow-xl overflow-hidden">
            <div className="border-b-2 border-slate-50 px-6 py-5 bg-slate-50/50 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black uppercase tracking-tight text-slate-900">Today&apos;s Roster</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Deployment Status</p>
              </div>
              <span className="rounded-xl bg-white border-2 border-slate-100 px-4 py-2 text-xs font-black text-slate-900 shadow-sm">
                {new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
              </span>
            </div>

            <div className="divide-y-2 divide-slate-50 max-h-[75vh] overflow-y-auto">
              {roster.length === 0 ? (
                <p className="px-6 py-12 text-sm font-bold text-slate-400 text-center uppercase tracking-widest">No staff data synced.</p>
              ) : (
                roster.map((r) => (
                  <div key={r.staffId} className={`flex items-center gap-4 px-6 py-5 transition-all ${
                    r.status === "IN" ? "bg-emerald-50/30 border-l-4 border-emerald-500" :
                    r.status === "OUT" ? "bg-slate-50/30 border-l-4 border-slate-300" :
                    "bg-white border-l-4 border-transparent"
                  }`}>
                    {/* Status icon */}
                    <div className={`flex-shrink-0 rounded-2xl p-3 shadow-sm ${
                      r.status === "IN" ? "bg-emerald-500 text-white" :
                      r.status === "OUT" ? "bg-slate-200 text-slate-500" :
                      "bg-rose-50 text-rose-300"
                    }`}>
                      {r.status === "IN" ? <UserCheck size={20} /> :
                       r.status === "OUT" ? <Clock size={20} /> :
                       <UserX size={20} />}
                    </div>

                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-base font-black truncate ${r.status === "ABSENT" ? "text-slate-300" : "text-slate-900"}`}>
                        {r.name}
                      </p>
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{r.role}</p>
                    </div>

                    {/* Right: badge + time */}
                    <div className="flex-shrink-0 text-right">
                      <span className={`inline-flex rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.15em] shadow-sm ${
                        r.status === "IN"
                          ? r.isLate
                            ? "bg-amber-100 text-amber-700"
                            : "bg-emerald-600 text-white"
                          : r.status === "OUT"
                          ? "bg-slate-100 text-slate-500"
                          : "bg-rose-50 text-rose-400"
                      }`}>
                        {r.status === "IN" && r.isLate ? "Late" : r.status}
                      </span>
                      {r.time && (
                        <p className="text-[11px] font-black text-slate-900 mt-2">
                          {new Date(r.time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
