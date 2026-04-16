'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { Camera, AlertTriangle, ShieldAlert, CheckCircle, LogOut, LogIn } from 'lucide-react'
import { ensureFaceModelsLoaded, probeFaceFrame } from '../../../lib/face-client'
import { findBestFaceMatch, toFaceDescriptor, type FaceProfileSummary } from '../../../lib/face-matching'

// ─── Types ────────────────────────────────────────────────────────────────────

type StaffStatus = {
  staffId: number
  staffName: string
  role: string
  checkIn: string | null
  checkOut: string | null
  hoursWorked: number | null
  status: 'IN' | 'OUT' | 'ABSENT'
  scanCount: number
  expectedCheckIn:  string | null
  expectedCheckOut: string | null
  lateGraceMinutes: number
  lateCheckIn:  boolean
  lateCheckOut: boolean
}

type IdentifiedPerson = {
  staffId: number
  staffName: string
  role: string
  confidence: number
  distance: number
  previewDataUrl: string
  descriptor: number[]
}

type ActionResult = { text: string; type: 'success' | 'error' | 'info' } | null

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function fmtHours(h: number | null) {
  if (h === null) return '—'
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${hh}h ${mm}m`
}

function beep(type: 'ok' | 'err') {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = ctx.createOscillator()
    osc.type = type === 'ok' ? 'sine' : 'sawtooth'
    osc.frequency.setValueAtTime(type === 'ok' ? 1200 : 220, ctx.currentTime)
    osc.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + (type === 'ok' ? 0.12 : 0.35))
  } catch { /* audio optional */ }
}

function parseFaceProfiles(rawStaff: any[]): FaceProfileSummary[] {
  return rawStaff.flatMap(staff => {
    const payload = staff.faceProfile ?? (staff.face_profile_json ? (() => {
      try { return JSON.parse(staff.face_profile_json) } catch { return null }
    })() : null)
    if (!payload) return []
    const descriptor = toFaceDescriptor(payload.descriptor)
    const samples = Array.isArray(payload.samples)
      ? payload.samples
          .map((s: any) => toFaceDescriptor(s.descriptor))
          .filter((v: any): v is number[] => Boolean(v))
          .map((d: number[]) => ({ descriptor: d }))
      : []
    return [{
      staffId: staff.id,
      staffName: staff.name,
      role: staff.role,
      threshold: payload.threshold ?? 0.52,
      sampleCount: payload.sampleCount ?? samples.length,
      descriptor,
      samples,
    }]
  })
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AttendancePage() {
  const { data: session } = useSession()
  const user = session?.user as { id?: string; name?: string; role?: string } | undefined
  const isAdmin = user?.role === 'ADMIN'

  // Attendance table state
  const [statusList, setStatusList] = useState<StaffStatus[]>([])
  const [tableLoading, setTableLoading] = useState(true)
  const [viewDate] = useState(new Date().toISOString().slice(0, 10))

  // Face model + profiles
  const [faceProfiles, setFaceProfiles] = useState<FaceProfileSummary[]>([])
  const [faceReady, setFaceReady] = useState(false)
  const [modelMessage, setModelMessage] = useState('Loading face models…')

  // Camera state
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Auto-detect loop
  const detectLoopRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDetectingRef = useRef(false) // prevent overlapping probes
  const [detecting, setDetecting] = useState(false) // UI indicator
  const [liveStatus, setLiveStatus] = useState<'scanning' | 'face_found' | 'no_face'>('no_face')

  // Identified person (shown until action is taken or camera closed)
  const [identified, setIdentified] = useState<IdentifiedPerson | null>(null)
  const [actionResult, setActionResult] = useState<ActionResult>(null)
  const [submitting, setSubmitting] = useState(false)

  // ── Data loaders ──────────────────────────────────────────────────────────

  const loadStatus = useCallback(async (date?: string) => {
    setTableLoading(true)
    try {
      const data = await fetch(`/api/attendance?date=${date ?? viewDate}`).then(r => r.json())
      setStatusList(Array.isArray(data) ? data : [])
    } finally {
      setTableLoading(false)
    }
  }, [viewDate])

  const loadFaceProfiles = useCallback(async () => {
    const raw = await fetch('/api/staff').then(r => r.json())
    setFaceProfiles(Array.isArray(raw) ? parseFaceProfiles(raw) : [])
  }, [])

  useEffect(() => {
    loadStatus()
    loadFaceProfiles()
  }, [loadStatus, loadFaceProfiles])

  // Refresh table every 30s
  useEffect(() => {
    const id = setInterval(() => loadStatus(), 30_000)
    return () => clearInterval(id)
  }, [loadStatus])

  // Load face models once
  useEffect(() => {
    ensureFaceModelsLoaded()
      .then(() => { setFaceReady(true); setModelMessage('Face models ready') })
      .catch(err => { setFaceReady(false); setModelMessage(err instanceof Error ? err.message : 'Cannot load face models') })
  }, [])

  // ── Camera controls ───────────────────────────────────────────────────────

  async function startCamera() {
    setCameraError(null)
    setIdentified(null)
    setActionResult(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      setCameraOn(true)
    } catch {
      setCameraError('Could not access camera. Check browser permissions.')
    }
  }

  function stopCamera() {
    stopDetectLoop()
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOn(false)
    setLiveStatus('no_face')
    setIdentified(null)
  }

  // ── Auto-detect loop ──────────────────────────────────────────────────────
  // Runs every 800ms when camera is on and no person is identified yet

  function stopDetectLoop() {
    if (detectLoopRef.current) clearTimeout(detectLoopRef.current)
    detectLoopRef.current = null
    isDetectingRef.current = false
    setDetecting(false)
  }

  const runDetectLoop = useCallback(async () => {
    if (!faceReady || !videoRef.current || isDetectingRef.current) return

    isDetectingRef.current = true
    setDetecting(true)

    const result = await probeFaceFrame(videoRef.current)
    isDetectingRef.current = false
    setDetecting(false)

    if (!result.detected || !result.descriptor) {
      setLiveStatus('no_face')
      // Schedule next probe
      detectLoopRef.current = setTimeout(runDetectLoop, 800)
      return
    }

    setLiveStatus('face_found')

    // Match against enrolled profiles
    const outcome = findBestFaceMatch(result.descriptor, faceProfiles, { defaultThreshold: 0.52, margin: 0.08 })

    if (!outcome.match) {
      // Face detected but not recognized — keep scanning
      setLiveStatus('no_face')
      detectLoopRef.current = setTimeout(runDetectLoop, 1200)
      return
    }

    // Recognized — pause loop and show action panel
    beep('ok')
    setIdentified({
      staffId: outcome.match.staffId,
      staffName: outcome.match.staffName,
      role: outcome.match.role,
      confidence: outcome.match.confidence,
      distance: outcome.match.distance,
      previewDataUrl: result.previewDataUrl ?? '',
      descriptor: result.descriptor,
    })
  }, [faceReady, faceProfiles])

  // Start loop when camera turns on; stop when person is identified
  useEffect(() => {
    if (!cameraOn || !faceReady) return
    if (identified) { stopDetectLoop(); return }
    detectLoopRef.current = setTimeout(runDetectLoop, 500)
    return () => {
      if (detectLoopRef.current) clearTimeout(detectLoopRef.current)
    }
  }, [cameraOn, faceReady, identified, runDetectLoop])

  // ── Attendance actions ────────────────────────────────────────────────────

  async function submitAttendance(actionType: 'CHECK_IN' | 'CHECK_OUT') {
    if (!identified) return
    setSubmitting(true)
    setActionResult(null)
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffId: identified.staffId,
          faceDescriptor: identified.descriptor,
          actionType,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Attendance failed')

      beep('ok')
      const label = actionType === 'CHECK_IN' ? 'Checked IN' : 'Checked OUT'
      setActionResult({
        text: `${data.staff} — ${label} at ${fmtTime(data.time)}`,
        type: 'success',
      })
      await loadStatus()
      // After 2.5s reset and start scanning again
      setTimeout(() => {
        setIdentified(null)
        setActionResult(null)
      }, 2500)
    } catch (err: any) {
      beep('err')
      setActionResult({ text: err?.message ?? 'Failed', type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  async function markDirect(staffId: number) {
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId, allowManualOverride: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Mark failed')
      beep('ok')
      setActionResult({ text: `${data.staff} — ${data.type === 'CHECK_OUT' ? 'Checked OUT' : 'Checked IN'} · ${fmtTime(data.time)}`, type: 'success' })
      loadStatus()
    } catch (err: any) {
      beep('err')
      setActionResult({ text: err?.message ?? 'Failed', type: 'error' })
    }
  }

  // ─── Derived ──────────────────────────────────────────────────────────────

  const presentCount = statusList.filter(s => s.status === 'IN').length
  const totalCount = statusList.length
  const isToday = viewDate === new Date().toISOString().slice(0, 10)

  // Find today's log for the identified person
  const identifiedLog = identified
    ? statusList.find(s => s.staffId === identified.staffId) ?? null
    : null

  // Determine which actions are valid for the identified person
  const canCheckIn  = !identifiedLog?.checkIn
  const canCheckOut = !!identifiedLog?.checkIn && !identifiedLog?.checkOut

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="grid grid-cols-3 gap-6">

        {/* ── Left panel: camera + scan ─────────────────────────────────── */}
        <div className="col-span-1 space-y-4">

          {/* Camera card */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 pt-5 pb-3">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Face Attendance</p>
              <p className="text-[11px] text-gray-400">{modelMessage}</p>
            </div>

            {/* Video area */}
            <div className="relative bg-black mx-3 mb-3 rounded-xl overflow-hidden" style={{ aspectRatio: '4/3' }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ display: cameraOn ? 'block' : 'none' }}
              />

              {!cameraOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-900">
                  <Camera size={32} className="text-gray-600" />
                  <p className="text-xs text-gray-500">Camera off</p>
                </div>
              )}

              {/* Live scan overlay */}
              {cameraOn && !identified && (
                <div className="absolute inset-0 pointer-events-none">
                  {/* Corner brackets */}
                  <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-blue-400 rounded-tl" />
                  <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-blue-400 rounded-tr" />
                  <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-blue-400 rounded-bl" />
                  <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-blue-400 rounded-br" />

                  {/* Status pill */}
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
                    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold backdrop-blur-sm ${
                      liveStatus === 'face_found'
                        ? 'bg-emerald-500/80 text-white'
                        : 'bg-black/60 text-gray-300'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        detecting ? 'bg-blue-400 animate-pulse' : liveStatus === 'face_found' ? 'bg-emerald-300' : 'bg-gray-500'
                      }`} />
                      {detecting ? 'Scanning…' : liveStatus === 'face_found' ? 'Face detected' : 'Looking for face…'}
                    </div>
                  </div>
                </div>
              )}

              {/* Identified person overlay on camera */}
              {cameraOn && identified && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center p-3 gap-2">
                  {identified.previewDataUrl && (
                    <img
                      src={identified.previewDataUrl}
                      alt="Captured frame"
                      className="w-16 h-16 rounded-full object-cover border-2 border-emerald-400"
                    />
                  )}
                  <div className="text-center">
                    <p className="text-white font-bold text-sm">{identified.staffName}</p>
                    <p className="text-gray-300 text-[11px]">{identified.role}</p>
                    <p className="text-emerald-400 text-[11px] mt-0.5">
                      {Math.round(identified.confidence * 100)}% confidence
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Camera button */}
            <div className="px-3 pb-4">
              {!cameraOn ? (
                <button
                  onClick={startCamera}
                  disabled={!faceReady}
                  className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  Start Camera
                </button>
              ) : (
                <button
                  onClick={stopCamera}
                  className="w-full py-2.5 rounded-xl bg-gray-100 text-gray-700 font-semibold text-sm hover:bg-gray-200 transition-colors"
                >
                  Stop Camera
                </button>
              )}
              {cameraError && (
                <p className="text-xs text-red-500 mt-2 text-center">{cameraError}</p>
              )}
            </div>
          </div>

          {/* ── Action panel: shown after face is identified ── */}
          {identified && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle size={15} className="text-emerald-500" />
                <p className="text-sm font-bold text-gray-900">{identified.staffName}</p>
              </div>
              <p className="text-xs text-gray-500">{identified.role} · {Math.round(identified.confidence * 100)}% match</p>

              {identifiedLog?.checkIn && (
                <p className="text-[11px] text-gray-400">
                  Today: In {fmtTime(identifiedLog.checkIn)}{identifiedLog.checkOut ? ` · Out ${fmtTime(identifiedLog.checkOut)}` : ' · still in'}
                </p>
              )}

              <div className="flex flex-col gap-2">
                <button
                  onClick={() => submitAttendance('CHECK_IN')}
                  disabled={submitting || !canCheckIn}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 disabled:opacity-40 transition-colors"
                >
                  <LogIn size={16} />
                  Check In
                </button>
                <button
                  onClick={() => submitAttendance('CHECK_OUT')}
                  disabled={submitting || !canCheckOut}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 disabled:opacity-40 transition-colors"
                >
                  <LogOut size={16} />
                  Check Out
                </button>
              </div>

              <button
                onClick={() => { setIdentified(null); setActionResult(null) }}
                className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 font-medium"
              >
                Not me — scan again
              </button>
            </div>
          )}

          {/* Action result */}
          {actionResult && (
            <div className={`rounded-xl px-4 py-3 text-sm font-semibold ${
              actionResult.type === 'success'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : actionResult.type === 'info'
                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {actionResult.type === 'success' ? '✓ ' : '✗ '}{actionResult.text}
            </div>
          )}

          {/* Enrolled profiles count */}
          <p className="text-[11px] text-center text-gray-400">
            {faceProfiles.length} face profile{faceProfiles.length !== 1 ? 's' : ''} enrolled
          </p>

          {/* Reliability note (admin) */}
          {isAdmin && (
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-[11px] text-slate-500 space-y-2">
              <div className="font-bold text-slate-700 uppercase tracking-tighter flex items-center gap-2">
                <ShieldAlert size={12} />
                Tips for best accuracy
              </div>
              <ul className="pl-4 list-disc space-y-1 text-slate-400">
                <li>Enroll 4–5 samples per person with slight angle variation.</li>
                <li>Use consistent lighting — avoid backlighting from windows.</li>
                <li>Camera should be at face height, ~50–80 cm away.</li>
                <li>Re-enroll if accuracy drops after a few weeks.</li>
              </ul>
            </div>
          )}

          {/* Manual override (admin only) */}
          {isAdmin && (
            <details className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-widest text-gray-500">Manual override</summary>
              <div className="mt-3 space-y-2 max-h-56 overflow-auto">
                {statusList.map(item => (
                  <button
                    key={item.staffId}
                    onClick={() => markDirect(item.staffId)}
                    className="w-full text-left px-3 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-xs text-slate-700 border border-slate-200"
                  >
                    {item.staffName} <span className="text-slate-400">({item.role})</span>
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* ── Right panel: today's attendance table ─────────────────────── */}
        <div className="col-span-2 space-y-4">
          {/* Summary tiles */}
          <div className="flex gap-3">
            <div className="flex-1 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
              <div className="text-2xl font-black text-emerald-700">{presentCount}</div>
              <div className="text-xs font-semibold text-emerald-600 mt-0.5">Currently In</div>
            </div>
            <div className="flex-1 bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
              <div className="text-2xl font-black text-blue-700">{statusList.filter(s => s.status === 'OUT').length}</div>
              <div className="text-xs font-semibold text-blue-600 mt-0.5">Checked Out</div>
            </div>
            <div className="flex-1 bg-gray-100 border border-gray-200 rounded-xl p-3 text-center">
              <div className="text-2xl font-black text-gray-500">{statusList.filter(s => s.status === 'ABSENT').length}</div>
              <div className="text-xs font-semibold text-gray-500 mt-0.5">Not In Yet</div>
            </div>
            <div className="flex-1 bg-white border border-gray-200 rounded-xl p-3 text-center">
              <div className="text-2xl font-black text-gray-700">{totalCount}</div>
              <div className="text-xs font-semibold text-gray-500 mt-0.5">Total Staff</div>
            </div>
          </div>

          {/* Table */}
          {tableLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-7 h-7 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Staff</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Progress</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Check In</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Check Out</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {statusList.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-gray-400">No active staff found.</td>
                    </tr>
                  )}
                  {statusList.map(item => {
                    const hasOffense = item.lateCheckIn || item.lateCheckOut
                    return (
                      <tr
                        key={item.staffId}
                        className={`transition-colors ${
                          identified?.staffId === item.staffId ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' :
                          hasOffense ? 'bg-red-50/60' :
                          item.status === 'IN' ? 'bg-emerald-50/40' :
                          item.status === 'OUT' ? 'bg-blue-50/20' : ''
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className={`font-semibold ${hasOffense ? 'text-red-700' : 'text-gray-900'}`}>
                            {item.staffName}
                            {hasOffense && (
                              <span className="ml-2 text-[10px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded uppercase tracking-wider">
                                {item.lateCheckIn && item.lateCheckOut ? 'Late IN & OUT' : item.lateCheckIn ? 'Late IN' : 'Early OUT'}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-400">{item.role}</div>
                          {item.expectedCheckIn && (
                            <div className="text-[10px] text-gray-400 mt-0.5">
                              Sched: {item.expectedCheckIn}{item.expectedCheckOut ? ` – ${item.expectedCheckOut}` : ''}
                              {item.lateGraceMinutes > 0 && ` (${item.lateGraceMinutes}m grace)`}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <div className="flex gap-1">
                              <div className={`w-3 h-1.5 rounded-full ${item.scanCount >= 1 ? 'bg-emerald-500' : 'bg-gray-200'}`} />
                              <div className={`w-3 h-1.5 rounded-full ${item.scanCount >= 2 ? 'bg-emerald-500' : 'bg-gray-200'}`} />
                            </div>
                            <span className={`text-[10px] font-black ${item.scanCount === 2 ? 'text-emerald-600' : 'text-gray-400'}`}>
                              {item.scanCount}/2
                            </span>
                          </div>
                        </td>
                        <td className={`px-4 py-3 text-center font-mono ${item.lateCheckIn ? 'text-red-600 font-bold' : 'text-gray-600'}`}>
                          {fmtTime(item.checkIn)}
                          {item.lateCheckIn && <div className="text-[10px] text-red-500 font-semibold">LATE</div>}
                        </td>
                        <td className={`px-4 py-3 text-center font-mono ${item.lateCheckOut ? 'text-red-600 font-bold' : 'text-gray-600'}`}>
                          {fmtTime(item.checkOut)}
                          {item.lateCheckOut && <div className="text-[10px] text-red-500 font-semibold">LATE</div>}
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-gray-700">
                          {item.status === 'IN'
                            ? <span className="text-emerald-600">{fmtHours(item.hoursWorked)} ▸</span>
                            : fmtHours(item.hoursWorked)
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                {statusList.some(s => s.hoursWorked !== null) && (
                  <tfoot>
                    <tr className="bg-gray-50 border-t border-gray-200">
                      <td colSpan={3} className="px-4 py-2.5 text-xs font-bold text-gray-500">Total man-hours today</td>
                      <td />
                      <td className="px-4 py-2.5 text-center font-black text-gray-800">
                        {fmtHours(statusList.reduce((sum, s) => sum + (s.hoursWorked ?? 0), 0))}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {/* Absent alert */}
          {isAdmin && statusList.some(s => !s.checkIn && s.status === 'ABSENT') && isToday && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-bold">Not yet in today: </span>
                {statusList.filter(s => s.status === 'ABSENT').map(s => s.staffName).join(', ')}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
