'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { Camera, RefreshCw, UserCheck, UserX, AlertTriangle, ShieldAlert } from 'lucide-react'
import { captureFaceSample, ensureFaceModelsLoaded } from '../../../lib/face-client'
import { findBestFaceMatch, toFaceDescriptor, type FaceProfileSummary } from '../../../lib/face-matching'

type StaffStatus = {
  staffId: number
  staffName: string
  role: string
  checkIn: string | null
  checkOut: string | null
  hoursWorked: number | null
  status: 'IN' | 'OUT' | 'ABSENT'
  scanCount: number
}

type ScanResult = { text: string; type: 'success' | 'error' | 'info' } | null

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
  } catch {
    // Audio is optional.
  }
}

function parseFaceProfiles(rawStaff: Array<{
  id: number
  name: string
  role: string
  faceProfile?: {
    threshold?: number | null
    sampleCount?: number | null
    descriptor?: unknown
    samples?: Array<{ descriptor?: unknown }>
  } | null
  face_profile_json?: string | null
}>): FaceProfileSummary[] {
  return rawStaff.flatMap(staff => {
    const payload = staff.faceProfile ?? (staff.face_profile_json ? (() => {
      try {
        return JSON.parse(staff.face_profile_json as string) as {
          threshold?: number
          sampleCount?: number
          descriptor?: unknown
          samples?: Array<{ descriptor?: unknown }>
        }
      } catch {
        return null
      }
    })() : null)

    if (!payload) return []

    const descriptor = toFaceDescriptor(payload.descriptor)
    const samples = Array.isArray(payload.samples)
      ? payload.samples
          .map(sample => toFaceDescriptor(sample.descriptor))
          .filter((value): value is number[] => Boolean(value))
          .map(descriptorValue => ({ descriptor: descriptorValue }))
      : []

    return [{
      staffId: staff.id,
      staffName: staff.name,
      role: staff.role,
      threshold: payload.threshold ?? 0.48,
      sampleCount: payload.sampleCount ?? samples.length,
      descriptor,
      samples,
    }]
  })
}

export default function AttendancePage() {
  const { data: session } = useSession()
  const user = session?.user as { id?: string; name?: string; role?: string } | undefined
  const isAdmin = user?.role === 'ADMIN'

  const [status, setStatus] = useState<StaffStatus[]>([])
  const [faceProfiles, setFaceProfiles] = useState<FaceProfileSummary[]>([])
  const [scanResult, setScanResult] = useState<ScanResult>(null)
  const [viewDate] = useState(new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(true)
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [faceReady, setFaceReady] = useState(false)
  const [modelMessage, setModelMessage] = useState('Loading face models...')
  const [showCamera, setShowCamera] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const loadStatus = useCallback(async (date?: string) => {
    setLoading(true)
    try {
      const activeDate = date ?? viewDate
      const data = await fetch(`/api/attendance?date=${activeDate}`).then(r => r.json())
      setStatus(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [viewDate])

  const loadFaceProfiles = useCallback(async () => {
    setProfilesLoading(true)
    try {
      const rawStaff = await fetch('/api/staff').then(r => r.json())
      setFaceProfiles(Array.isArray(rawStaff) ? parseFaceProfiles(rawStaff) : [])
    } finally {
      setProfilesLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus(viewDate)
    loadFaceProfiles()
  }, [viewDate, loadStatus, loadFaceProfiles])

  useEffect(() => {
    const id = setInterval(() => loadStatus(viewDate), 30_000)
    return () => clearInterval(id)
  }, [viewDate, loadStatus])

  useEffect(() => {
    ensureFaceModelsLoaded()
      .then(() => {
        setFaceReady(true)
        setModelMessage('Face models ready')
      })
      .catch(error => {
        setFaceReady(false)
        setModelMessage(error instanceof Error ? error.message : 'Unable to load face models')
      })
  }, [])

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      setShowCamera(true)
      setScanResult({ text: 'Center one face and capture a clean frame.', type: 'info' })
    } catch {
      beep('err')
      setScanResult({ text: 'Could not access camera.', type: 'error' })
    }
  }

  function stopCamera() {
    try {
      streamRef.current?.getTracks().forEach(track => track.stop())
    } catch {
      // ignore camera shutdown errors
    }
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setShowCamera(false)
    setCapturing(false)
  }

  async function captureAndSubmit() {
    if (!videoRef.current) return
    if (!faceReady) {
      setScanResult({ text: modelMessage, type: 'error' })
      return
    }
    if (faceProfiles.length === 0) {
      setScanResult({ text: 'No face profiles have been enrolled yet.', type: 'error' })
      return
    }

    setCapturing(true)
    try {
      const sample = await captureFaceSample(videoRef.current)
      const matchOutcome = findBestFaceMatch(sample.descriptor, faceProfiles, { defaultThreshold: 0.48, margin: 0.05 })

      if (!matchOutcome.match) {
        throw new Error(matchOutcome.reason ?? 'Face match failed')
      }

      const response = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffId: matchOutcome.match.staffId,
          faceDescriptor: sample.descriptor,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Attendance mark failed')
      }

      beep('ok')
      setScanResult({
        text: `${data.staff} — ${data.type === 'CHECK_OUT' ? 'Clocked OUT' : 'Clocked IN'} · ${fmtTime(data.time)}`,
        type: 'success',
      })
      await loadStatus(viewDate)
      stopCamera()
    } catch (error: any) {
      beep('err')
      setScanResult({ text: error?.message ?? 'Failed to capture face', type: 'error' })
    } finally {
      setCapturing(false)
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
      setScanResult({ text: `${data.staff} — ${data.type === 'CHECK_OUT' ? 'Clocked OUT' : 'Clocked IN'} · ${fmtTime(data.time)}`, type: 'success' })
      loadStatus(viewDate)
    } catch (error: any) {
      beep('err')
      setScanResult({ text: error?.message ?? 'Failed', type: 'error' })
    }
  }

  const presentCount = status.filter(item => item.status === 'IN').length
  const totalCount = status.length
  const isToday = viewDate === new Date().toISOString().slice(0, 10)

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-1 space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center shadow-sm">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-5">Face Attendance</p>

            <div className="relative flex justify-center mb-5">
              <div className={`absolute inset-0 bg-blue-100 rounded-full blur-2xl scale-150 opacity-0 transition-opacity duration-500 ${showCamera ? 'opacity-60 animate-pulse' : ''}`} />
              <div className="flex flex-col items-center gap-3 w-full">
                {showCamera ? (
                  <div className="space-y-3 w-full">
                    <video ref={videoRef} autoPlay playsInline muted className="mx-auto w-44 h-44 bg-black rounded-2xl object-cover" />
                    <div className="flex gap-2 justify-center flex-wrap">
                      <button
                        onClick={captureAndSubmit}
                        disabled={capturing}
                        className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-500 disabled:opacity-50"
                      >
                        {capturing ? 'Analyzing...' : 'Capture face'}
                      </button>
                      <button onClick={stopCamera} className="bg-slate-200 px-4 py-2 rounded-lg font-medium text-slate-700 hover:bg-slate-300">
                        Stop camera
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={startCamera}
                    className={`relative z-10 w-28 h-28 rounded-full border-4 flex items-center justify-center transition-all duration-200 ${
                      faceReady
                        ? 'border-blue-400 bg-blue-50 text-blue-600 hover:border-blue-500 hover:bg-blue-100'
                        : 'border-gray-200 bg-white text-gray-400'
                    }`}
                  >
                    <Camera size={26} />
                  </button>
                )}
              </div>
            </div>

            <p className="text-xs text-gray-500 mb-2">{modelMessage}</p>
            <p className="text-xs text-gray-400 mb-4">{profilesLoading ? 'Loading enrolled faces...' : `${faceProfiles.length} face profile${faceProfiles.length === 1 ? '' : 's'} enrolled`}</p>

            {scanResult && (
              <div className={`rounded-xl px-4 py-3 text-sm font-semibold mb-4 ${
                scanResult.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : scanResult.type === 'info'
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {scanResult.type === 'success' ? '✓ ' : scanResult.type === 'error' ? '✗ ' : 'i '}{scanResult.text}
              </div>
            )}
          </div>

          {isAdmin && (
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-[11px] text-slate-500 space-y-2">
              <div className="font-bold text-slate-700 uppercase tracking-tighter flex items-center gap-2">
                <ShieldAlert size={12} />
                Reliability note
              </div>
              <div className="pl-4 border-l-2 border-slate-200 py-1">
                Hold one face in frame, use clear lighting, and recapture if the app flags ambiguity.
              </div>
            </div>
          )}

          <details className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-widest text-gray-500">Manual override</summary>
            <div className="mt-3 space-y-2 max-h-56 overflow-auto">
              {status.map(item => (
                <button
                  key={item.staffId}
                  onClick={() => markDirect(item.staffId)}
                  className="w-full text-left px-3 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-xs text-slate-700 border border-slate-200 transition-colors"
                >
                  {item.staffName} <span className="text-slate-400">({item.role})</span>
                </button>
              ))}
            </div>
          </details>
        </div>

        <div className="col-span-2 space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
              <div className="text-2xl font-black text-emerald-700">{presentCount}</div>
              <div className="text-xs font-semibold text-emerald-600 mt-0.5">Currently In</div>
            </div>
            <div className="flex-1 bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
              <div className="text-2xl font-black text-blue-700">{status.filter(item => item.status === 'OUT').length}</div>
              <div className="text-xs font-semibold text-blue-600 mt-0.5">Checked Out</div>
            </div>
            <div className="flex-1 bg-gray-100 border border-gray-200 rounded-xl p-3 text-center">
              <div className="text-2xl font-black text-gray-500">{status.filter(item => item.status === 'ABSENT').length}</div>
              <div className="text-xs font-semibold text-gray-500 mt-0.5">Not In Yet</div>
            </div>
            <div className="flex-1 bg-white border border-gray-200 rounded-xl p-3 text-center">
              <div className="text-2xl font-black text-gray-700">{totalCount}</div>
              <div className="text-xs font-semibold text-gray-500 mt-0.5">Total Staff</div>
            </div>
          </div>

          {loading ? (
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
                  {status.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-gray-400">No active staff found.</td>
                    </tr>
                  )}
                  {status.map(item => (
                    <tr
                      key={item.staffId}
                      className={`transition-colors ${item.status === 'IN' ? 'bg-emerald-50/40' : item.status === 'OUT' ? 'bg-blue-50/20' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900">{item.staffName}</div>
                        <div className="text-xs text-gray-400">{item.role}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <div className="flex gap-1">
                            <div className={`w-3 h-1.5 rounded-full ${item.scanCount >= 1 ? 'bg-emerald-500 shadow-sm shadow-emerald-200' : 'bg-gray-200'}`} />
                            <div className={`w-3 h-1.5 rounded-full ${item.scanCount >= 2 ? 'bg-emerald-500 shadow-sm shadow-emerald-200' : 'bg-gray-200'}`} />
                          </div>
                          <span className={`text-[10px] font-black ${item.scanCount === 2 ? 'text-emerald-600' : 'text-gray-400'}`}>
                            {item.scanCount}/2
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-gray-600">{fmtTime(item.checkIn)}</td>
                      <td className="px-4 py-3 text-center font-mono text-gray-600">{fmtTime(item.checkOut)}</td>
                      <td className="px-4 py-3 text-center font-semibold text-gray-700">
                        {item.status === 'IN' ? <span className="text-emerald-600">{fmtHours(item.hoursWorked)} ▸</span> : fmtHours(item.hoursWorked)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {status.some(item => item.hoursWorked !== null) && (
                  <tfoot>
                    <tr className="bg-gray-50 border-t border-gray-200">
                      <td colSpan={3} className="px-4 py-2.5 text-xs font-bold text-gray-500">Total man-hours today</td>
                      <td />
                      <td className="px-4 py-2.5 text-center font-black text-gray-800">
                        {fmtHours(status.reduce((sum, item) => sum + (item.hoursWorked ?? 0), 0))}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {isAdmin && status.some(item => !item.checkIn && item.status === 'ABSENT') && isToday && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5" />
              <div>
                <span className="font-bold">Absent today: </span>
                {status.filter(item => item.status === 'ABSENT').map(item => item.staffName).join(', ')}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
