"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import * as faceapi from "face-api.js"
import { nanoid } from "nanoid"
import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"
import { UserCheck, UserX, Clock, Loader2, Camera, Shield, UserRoundCheck, UserRoundX } from "lucide-react"

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

function euclideanDist(a: Float32Array, b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) { const d = a[i] - (b[i] ?? 0); s += d * d }
  return Math.sqrt(s)
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
  const [enrolledCount, setEnrolledCount] = useState(0)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loadingAction, setLoadingAction] = useState<"CLOCK_IN" | "CLOCK_OUT" | null>(null)
  const [manualReason, setManualReason] = useState("")

  // ── Load models, profile list, and session role on mount ───────────────────
  useEffect(() => {
    mountedRef.current = true

    async function init(): Promise<void> {
      try {
        setStatusMsg("Loading face models…")
        await faceapi.nets.tinyFaceDetector.loadFromUri("/models")
        await faceapi.nets.faceLandmark68TinyNet.loadFromUri("/models")
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
        setStatusMsg("Select a staff member to start live face verification.")
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

  useEffect(() => {
    if (selectedStaffId == null) {
      setSelectedFaceMatch(null)
      return
    }
    setSelectedFaceMatch(null)
    setStatusMsg(modelsLoaded ? "Camera ready. Face verification will lock to the selected staff member." : "Loading face models…")
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
  }

  useEffect(() => {
    if (!modelsLoaded || selectedStaffId == null) return
    if (!cameraActive) {
      void startCamera()
    }
  }, [cameraActive, modelsLoaded, selectedStaffId, startCamera])

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
    if (scanState !== "ready" || !cameraActive || !selectedProfile) return

    let cancelled = false
    scanningRef.current = true

    async function loop(): Promise<void> {
      const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 })

      while (!cancelled) {
        const video = videoRef.current
        if (!video || video.readyState < 2) {
          await delay(200)
          continue
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let det: any = null
        try {
          const raw = await faceapi.detectSingleFace(video, opts).withFaceLandmarks(true).withFaceDescriptor()
          det = raw ?? null
        } catch { /* continue */ }

        if (!det) {
          setStatusMsg("No face detected. Keep the selected staff member in frame.")
          await delay(200)
          continue
        }

        const profile = selectedProfile
        if (!profile || !profile.descriptor || profile.descriptor.length === 0) {
          setStatusMsg(`${selectedStaffName ?? "Selected staff"} has no enrolled face profile.`)
          await delay(1500)
          continue
        }

        setStatusMsg(`Matching ${profile.staffName}…`)

        const threshold = Math.min(0.6, Math.max(0.35, profile.threshold))
        const dist = euclideanDist(det!.descriptor, profile.descriptor as number[])
        const confidence = Math.max(0, Math.min(1, 1 - dist / threshold))

        if (dist > threshold) {
          setSelectedFaceMatch(null)
          setStatusMsg("Face mismatch. Keep the selected staff member in view.")
          await delay(1200)
          continue
        }

        setSelectedFaceMatch({ confidence })
        setStatusMsg(`Matched ${profile.staffName}. Choose check in or check out.`)
        await delay(1000)
      }
    }

    loop()
    return () => { cancelled = true; scanningRef.current = false }
  }, [cameraActive, fetchRoster, scanState, selectedProfile, selectedStaffName])

  const presentCount = roster.filter((r) => r.status === "IN").length
  const absentCount = roster.filter((r) => r.status === "ABSENT").length
  const outCount = roster.filter((r) => r.status === "OUT").length

  return (
    <PageShell title="Attendance Kiosk" subtitle="Select staff, verify face, then choose check in / check out.">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">

        {/* ── Camera Panel ── */}
        <div className="lg:col-span-3 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div className="flex-1">
                <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Select staff member</p>
                <select
                  value={selectedStaffId ?? ""}
                  onChange={(e) => {
                    const next = e.target.value ? Number(e.target.value) : null
                    setSelectedStaffId(next)
                    setSelectedFaceMatch(null)
                    if (!next) stopCamera()
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none"
                >
                  <option value="">Choose a person to verify…</option>
                  {staffOptions.map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name} · {staff.role}{staff.faceEnrolled ? ` · face ${staff.faceSampleCount}` : " · no face"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500 md:w-64">
                Live scan locks to the selected staff member only.
              </div>
            </div>
          </div>

          {/* Video */}
          <div className="relative rounded-2xl overflow-hidden bg-slate-900 shadow-2xl aspect-[4/3]">
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
                <p className="text-slate-300 text-sm font-semibold">Select a staff member to start live face verification.</p>
              </div>
            )}

            {/* Status bar */}
            {scanState === "ready" && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-5 pb-4 pt-8">
                <p className="text-white text-sm font-semibold text-center tracking-wide">{statusMsg}</p>
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
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
              <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-slate-500">Selected staff</p>
                  <p className="text-lg font-black text-slate-900">{selectedStaff.name}</p>
                  <p className="text-xs text-slate-400 uppercase tracking-wider">{selectedStaff.role}</p>
                </div>
                <div className="text-right text-xs font-semibold text-slate-500">
                    {selectedDayStatus?.hasClockIn ? (selectedDayStatus.hasClockOut ? "Checked in and out today" : "Already checked in today") : "Not marked yet today"}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Button
                  variant="primary"
                  className="w-full justify-center gap-2"
                  disabled={!selectedFaceMatch || !canClockIn || loadingAction !== null}
                  onClick={() => void submitPunch("CLOCK_IN", "FACE", selectedFaceMatch?.confidence)}
                >
                  <UserRoundCheck size={15} /> {loadingAction === "CLOCK_IN" ? "Checking in…" : "Check In"}
                </Button>
                <Button
                  variant="secondary"
                  className="w-full justify-center gap-2"
                  disabled={!selectedFaceMatch || !canClockOut || loadingAction !== null}
                  onClick={() => void submitPunch("CLOCK_OUT", "FACE", selectedFaceMatch?.confidence)}
                >
                  <UserRoundX size={15} /> {loadingAction === "CLOCK_OUT" ? "Checking out…" : "Check Out"}
                </Button>
              </div>

              {selectedFaceMatch && (
                <p className="text-sm font-semibold text-emerald-700 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
                  Face matched. Confidence {(selectedFaceMatch.confidence * 100).toFixed(0)}%.
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
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
              <p className="text-3xl font-black text-emerald-700">{presentCount}</p>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-500 mt-0.5">Present</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
              <p className="text-3xl font-black text-slate-500">{outCount}</p>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mt-0.5">Left</p>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-center">
              <p className="text-3xl font-black text-rose-600">{absentCount}</p>
              <p className="text-xs font-bold uppercase tracking-wider text-rose-400 mt-0.5">Absent</p>
            </div>
          </div>
        </div>

        {/* ── Roster Panel ── */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-3.5 flex items-center justify-between">
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-700">Today&apos;s Roster</h3>
              <span className="text-xs text-slate-400 font-medium">
                {new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
              </span>
            </div>

            <div className="divide-y divide-slate-50 max-h-[70vh] overflow-y-auto">
              {roster.length === 0 ? (
                <p className="px-5 py-8 text-sm text-slate-400 text-center">No staff data.</p>
              ) : (
                roster.map((r) => (
                  <div key={r.staffId} className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                    r.status === "IN" ? "bg-emerald-50/60" :
                    r.status === "OUT" ? "bg-slate-50/60" :
                    "bg-white"
                  }`}>
                    {/* Status icon */}
                    <div className={`flex-shrink-0 rounded-full p-1.5 ${
                      r.status === "IN" ? "bg-emerald-100 text-emerald-600" :
                      r.status === "OUT" ? "bg-slate-100 text-slate-400" :
                      "bg-rose-50 text-rose-300"
                    }`}>
                      {r.status === "IN" ? <UserCheck size={14} /> :
                       r.status === "OUT" ? <Clock size={14} /> :
                       <UserX size={14} />}
                    </div>

                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-bold truncate ${r.status === "ABSENT" ? "text-slate-400" : "text-slate-900"}`}>
                        {r.name}
                      </p>
                      <p className="text-[10px] text-slate-400 uppercase tracking-tight">{r.role}</p>
                    </div>

                    {/* Right: badge + time */}
                    <div className="flex-shrink-0 text-right">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                        r.status === "IN"
                          ? r.isLate
                            ? "bg-amber-100 text-amber-700"
                            : "bg-emerald-100 text-emerald-700"
                          : r.status === "OUT"
                          ? "bg-slate-100 text-slate-500"
                          : "bg-rose-50 text-rose-400"
                      }`}>
                        {r.status === "IN" && r.isLate ? "Late" : r.status}
                      </span>
                      {r.time && (
                        <p className="text-[10px] text-slate-400 mt-0.5">
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
