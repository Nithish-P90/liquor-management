'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { UserCheck, UserX, Camera, RefreshCw, AlertTriangle, ShieldAlert } from 'lucide-react'
import type { Staff, AttendanceRecord } from '../types'
import { captureFaceSample, ensureFaceModelsLoaded } from '../../../lib/face-client'
import { findBestFaceMatch, toFaceDescriptor, type FaceProfileSummary } from '../../../lib/face-matching'

type ScannerStatus = 'idle' | 'scanning' | 'ok' | 'err' | 'info'
type ScanResult = { text: string; type: 'success' | 'error' | 'info' } | null

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(checkIn: string, checkOut: string | null): string {
  const start = new Date(checkIn).getTime()
  const end = checkOut ? new Date(checkOut).getTime() : Date.now()
  const mins = Math.floor((end - start) / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
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

function parseFaceProfiles(staffList: Staff[]): FaceProfileSummary[] {
  return staffList.flatMap(staff => {
    if (!staff.face_profile_json) return []
    try {
      const profile = JSON.parse(staff.face_profile_json) as {
        threshold?: number
        sampleCount?: number
        descriptor?: unknown
        samples?: Array<{ descriptor?: unknown }>
      }

      const descriptor = toFaceDescriptor(profile.descriptor)
      const samples = Array.isArray(profile.samples)
        ? profile.samples
            .map(sample => toFaceDescriptor(sample.descriptor))
            .filter((value): value is number[] => Boolean(value))
            .map(descriptorValue => ({ descriptor: descriptorValue }))
        : []

      return [{
        staffId: staff.id,
        staffName: staff.name,
        role: staff.role,
        threshold: profile.threshold ?? 0.48,
        sampleCount: profile.sampleCount ?? samples.length,
        descriptor,
        samples,
      }]
    } catch {
      return []
    }
  })
}

export default function Attendance() {
  const [staff, setStaff] = useState<Staff[]>([])
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [scanStatus, setScanStatus] = useState<ScannerStatus>('idle')
  const [scanMessage, setScanMessage] = useState('')
  const [scanResult, setScanResult] = useState<ScanResult>(null)
  const [showCamera, setShowCamera] = useState(false)
  const [faceReady, setFaceReady] = useState(false)
  const [modelMessage, setModelMessage] = useState('Loading face models...')
  const [capturing, setCapturing] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const faceProfiles = useMemo(() => parseFaceProfiles(staff), [staff])

  const loadData = useCallback(async () => {
    const [staffList, attendanceList] = await Promise.all([
      window.posAPI.getStaff(),
      window.posAPI.getTodayAttendance(),
    ])
    setStaff(staffList)
    setRecords(attendanceList)
  }, [])

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 30_000)
    return () => clearInterval(interval)
  }, [loadData])

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
      setScanStatus('info')
      setScanMessage('Center one face in the frame, then capture.')
      setScanResult({ text: 'Ready to capture face.', type: 'info' })
    } catch {
      beep('err')
      setScanStatus('err')
      setScanMessage('Could not access camera')
      setScanResult({ text: 'Could not access camera', type: 'error' })
    }
  }

  function stopCamera() {
    try {
      streamRef.current?.getTracks().forEach(track => track.stop())
    } catch {
      // ignore shutdown issues
    }
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setShowCamera(false)
    setCapturing(false)
  }

  async function processAttendance(staffMember: Staff) {
    const existing = await window.posAPI.getAttendanceForStaffToday(staffMember.id)

    if (!existing || !existing.check_in) {
      const result = await window.posAPI.checkIn(staffMember.id, staffMember.name)
      if (result.ok) {
        setScanStatus('ok')
        setScanMessage(`✓ ${staffMember.name} checked IN at ${formatTime(result.record?.check_in ?? null)}`)
        setScanResult({ text: `${staffMember.name} checked IN`, type: 'success' })
      } else {
        setScanStatus('err')
        setScanMessage(result.error ?? 'Check-in failed')
        setScanResult({ text: result.error ?? 'Check-in failed', type: 'error' })
      }
    } else if (!existing.check_out) {
      const result = await window.posAPI.checkOut(staffMember.id)
      if (result.ok) {
        const duration = existing.check_in ? formatDuration(existing.check_in, result.record?.check_out ?? null) : ''
        setScanStatus('ok')
        setScanMessage(`✓ ${staffMember.name} checked OUT — ${duration}`)
        setScanResult({ text: `${staffMember.name} checked OUT`, type: 'success' })
      } else {
        setScanStatus('err')
        setScanMessage(result.error ?? 'Check-out failed')
        setScanResult({ text: result.error ?? 'Check-out failed', type: 'error' })
      }
    } else {
      setScanStatus('ok')
      setScanMessage(`${staffMember.name} already completed for today`)
      setScanResult({ text: `${staffMember.name} already completed for today`, type: 'info' })
    }

    await loadData()
    setTimeout(() => {
      setScanStatus('idle')
      setScanMessage('')
    }, 4000)
  }

  async function captureAndMark() {
    if (!videoRef.current) return
    if (!faceReady) {
      setScanStatus('err')
      setScanMessage(modelMessage)
      return
    }
    if (faceProfiles.length === 0) {
      setScanStatus('err')
      setScanMessage('No face profiles have been enrolled yet.')
      return
    }

    setCapturing(true)
    setScanStatus('scanning')
    setScanMessage('Analyzing face...')

    try {
      const sample = await captureFaceSample(videoRef.current)
      const matchOutcome = findBestFaceMatch(sample.descriptor, faceProfiles, { defaultThreshold: 0.48, margin: 0.05 })

      if (!matchOutcome.match) {
        throw new Error(matchOutcome.reason ?? 'No reliable face match found')
      }

      const staffMember = staff.find(item => item.id === matchOutcome.match?.staffId)
      if (!staffMember) {
        throw new Error('Matched face could not be resolved to a staff member')
      }

      await processAttendance(staffMember)
      stopCamera()
    } catch (error: any) {
      beep('err')
      setScanStatus('err')
      setScanMessage(error?.message ?? 'Face capture failed')
      setScanResult({ text: error?.message ?? 'Face capture failed', type: 'error' })
    } finally {
      setCapturing(false)
    }
  }

  async function markDirect(staffId: number) {
    const staffMember = staff.find(item => item.id === staffId)
    if (!staffMember) return
    await processAttendance(staffMember)
  }

  const present = records.filter(record => record.check_in)
  const checkedOut = records.filter(record => record.check_out)
  const stillIn = records.filter(record => record.check_in && !record.check_out)

  return (
    <div className="flex h-full bg-slate-900">
      <div className="w-80 flex-shrink-0 border-r border-slate-700 flex flex-col">
        <div className="px-4 py-3 bg-slate-800 border-b border-slate-700">
          <h2 className="text-sm font-semibold text-slate-200">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </h2>
          <div className="flex gap-4 mt-1 text-xs text-slate-400">
            <span className="text-emerald-400">{present.length} present</span>
            <span className="text-slate-500">{checkedOut.length} out</span>
            <span className="text-amber-400">{stillIn.length} in shop</span>
          </div>
        </div>

        <div className="flex border-b border-slate-700">
          <div className="flex-1 py-2 text-xs font-medium flex items-center justify-center gap-1.5 border-b-2 border-indigo-500 text-indigo-400">
            <Camera size={14} />
            Face
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-4">
          {showCamera ? (
            <>
              <video ref={videoRef} autoPlay playsInline muted className="w-56 h-40 bg-black rounded-xl object-cover" />
              <div className="flex gap-2">
                <button
                  onClick={captureAndMark}
                  disabled={capturing}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-500 disabled:opacity-50"
                >
                  {capturing ? 'Analyzing...' : 'Capture & Mark'}
                </button>
                <button onClick={stopCamera} className="bg-slate-700 text-slate-200 px-3 py-2 rounded-lg">
                  Stop
                </button>
              </div>
              {scanMessage && (
                <p className={`text-xs text-center px-4 ${scanStatus === 'ok' ? 'text-emerald-400' : scanStatus === 'err' ? 'text-red-400' : 'text-slate-300'}`}>
                  {scanMessage}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-slate-400 text-center">Use the camera to capture a face and mark attendance</p>
              <button
                onClick={startCamera}
                className={`w-40 rounded-lg py-2.5 text-sm font-medium transition-colors ${faceReady ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-slate-700 text-slate-300'}`}
              >
                Start camera
              </button>
              <p className="text-[11px] text-slate-500 text-center px-2">{modelMessage}</p>
              {scanResult && (
                <div className={`rounded-xl px-4 py-3 text-xs font-semibold text-center ${
                  scanResult.type === 'success'
                    ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-700/50'
                    : scanResult.type === 'info'
                      ? 'bg-blue-950/50 text-blue-300 border border-blue-700/50'
                      : 'bg-red-950/50 text-red-300 border border-red-700/50'
                }`}>
                  {scanResult.type === 'success' ? '✓ ' : scanResult.type === 'error' ? '✗ ' : 'i '}{scanResult.text}
                </div>
              )}

              <details className="w-full mt-2">
                <summary className="text-xs text-slate-500 mb-1 text-center cursor-pointer">Manual override</summary>
                <div className="space-y-1 max-h-40 overflow-auto">
                  {staff.map(item => (
                    <button
                      key={item.id}
                      onClick={() => markDirect(item.id)}
                      className="w-full text-left px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 transition-colors"
                    >
                      {item.name} <span className="text-slate-500">({item.role})</span>
                    </button>
                  ))}
                </div>
              </details>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 bg-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Today's Attendance</h2>
          <button onClick={loadData} className="text-slate-400 hover:text-slate-200">
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
          {records.length === 0 ? (
            <div className="text-center text-slate-600 py-12 text-sm">No attendance recorded today</div>
          ) : (
            <div className="space-y-2">
              {records.map(record => (
                <div key={record.local_id} className="flex items-center gap-3 bg-slate-800 rounded-lg px-3 py-2.5">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${record.check_out ? 'bg-slate-500' : 'bg-emerald-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-200">{record.staff_name}</div>
                    <div className="text-xs text-slate-400">
                      IN {formatTime(record.check_in)} {record.check_out ? `→ OUT ${formatTime(record.check_out)}` : '(still in)'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {record.check_in && <span className="text-xs text-slate-500">{formatDuration(record.check_in, record.check_out)}</span>}
                    {record.check_out ? <UserX size={14} className="text-slate-500" /> : <UserCheck size={14} className="text-emerald-400" />}
                    {record.synced === 0 && <span className="text-xs text-amber-400 w-4">●</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {staff.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-slate-500 mb-2">Not yet recorded today:</p>
              <div className="flex flex-wrap gap-2">
                {staff.filter(item => !records.find(record => record.staff_id === item.id)).map(item => (
                  <button
                    key={item.id}
                    onClick={() => markDirect(item.id)}
                    className="px-2 py-1 rounded bg-slate-800 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200 border border-slate-700 transition-colors"
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 bg-slate-800/70 border border-slate-700 rounded-lg p-3 text-xs text-slate-400 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 text-amber-400" />
            <div>
              <span className="font-semibold text-slate-200">Face data cache:</span> {faceProfiles.length} enrolled profile{faceProfiles.length === 1 ? '' : 's'} loaded locally.
            </div>
          </div>

          <div className="mt-3 bg-slate-800/70 border border-slate-700 rounded-lg p-3 text-[11px] text-slate-500 space-y-2">
            <div className="font-bold text-slate-200 uppercase tracking-tighter flex items-center gap-2">
              <ShieldAlert size={12} />
              Reliability note
            </div>
            <div className="pl-4 border-l-2 border-slate-700 py-1">
              Use clear lighting and keep one face centered. If the app reports ambiguity, recapture before marking.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
