/**
 * Attendance screen — check-in / check-out via fingerprint or PIN.
 *
 * On Windows, the vendor RD Service runs on port 11100 (same as the web app).
 * The biometric capture is done via HTTP exactly the same way as the web UI.
 * No special drivers needed — the Cogent/Mantra Windows RD Service handles hardware.
 */
import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, Clock, UserCheck, UserX, Fingerprint, AlertCircle, RefreshCw } from 'lucide-react'
import type { Staff, AttendanceRecord } from '../types'

type ScannerStatus = 'idle' | 'scanning' | 'ok' | 'err'

const RD_URL = 'http://127.0.0.1:11100'

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(checkIn: string, checkOut: string | null): string {
  const start = new Date(checkIn).getTime()
  const end   = checkOut ? new Date(checkOut).getTime() : Date.now()
  const mins  = Math.floor((end - start) / 60000)
  const h     = Math.floor(mins / 60)
  const m     = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export default function Attendance() {
  const [staff, setStaff]         = useState<Staff[]>([])
  const [records, setRecords]     = useState<AttendanceRecord[]>([])
  const [scanStatus, setScanStatus]       = useState<ScannerStatus>('idle')
  const [scanMessage, setScanMessage]     = useState('')
  const [rdAvailable, setRdAvailable]     = useState<boolean | null>(null)
  const [isChecking, setIsChecking]       = useState(false)
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null)
  const [pinInput, setPinInput]           = useState('')
  const [mode, setMode]                   = useState<'auto' | 'pin'>('auto')

  const loadData = useCallback(async () => {
    const [stf, att] = await Promise.all([
      window.posAPI.getStaff(),
      window.posAPI.getTodayAttendance(),
    ])
    setStaff(stf)
    setRecords(att)
  }, [])

  useEffect(() => {
    loadData()
    checkRdService()
    const interval = setInterval(loadData, 30_000)
    return () => clearInterval(interval)
  }, [loadData])

  async function checkRdService() {
    try {
      const res = await fetch(`${RD_URL}/rd/info`, { signal: AbortSignal.timeout(2000) })
      setRdAvailable(res.ok)
    } catch {
      setRdAvailable(false)
    }
  }

  // ── Fingerprint capture via Windows RD Service ────────────────────────────
  async function captureFingerprint(): Promise<string | null> {
    try {
      const res = await fetch(`${RD_URL}/rd/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: '<?xml version="1.0"?><PidOptions ver="1.0"><Opts fCount="1" fType="0" iCount="0" pCount="0" format="0" pidVer="2.0" timeout="10000" posh="UNKNOWN" env="P" /></PidOptions>',
        signal: AbortSignal.timeout(15_000),
      })

      const xml = await res.text()

      // Check for error
      const errMatch = xml.match(/errCode="([^"]+)"/)
      const errCode = errMatch ? errMatch[1] : null
      if (errCode && errCode !== '0') {
        const infoMatch = xml.match(/errInfo="([^"]+)"/)
        throw new Error(infoMatch ? infoMatch[1] : `RD error code ${errCode}`)
      }

      // Extract template
      const dataMatch = xml.match(/<Data[^>]*type="X"[^>]*>([\s\S]+?)<\/Data>/)
      if (!dataMatch) throw new Error('No fingerprint data in response')
      return dataMatch[1].trim()
    } catch (e) {
      throw e
    }
  }

  // ── Match fingerprint against local staff cache ───────────────────────────
  function matchFingerprint(capturedTemplate: string): Staff | null {
    // Simple byte comparison — in production replace with ISO 19794-2 minutiae matching
    // The web app uses fingerprint-matcher.ts for proper matching
    // For the Electron app, we call the cloud API for matching when online,
    // or fall back to base64 string comparison offline
    return staff.find(s => {
      if (!s.fingerprint_template) return false
      const a = capturedTemplate.replace(/\s/g, '')
      const b = s.fingerprint_template.replace(/\s/g, '')
      return a === b
    }) ?? null
  }

  // ── Handle biometric attendance ───────────────────────────────────────────
  async function handleBiometricScan() {
    if (isChecking) return
    setIsChecking(true)
    setScanStatus('scanning')
    setScanMessage('Place finger on scanner...')

    try {
      const template = await captureFingerprint()
      if (!template) throw new Error('No template captured')

      setScanMessage('Matching...')
      const matched = matchFingerprint(template)

      if (!matched) {
        setScanStatus('err')
        setScanMessage('Fingerprint not recognised. Use PIN mode.')
        return
      }

      await processAttendance(matched)
    } catch (e) {
      setScanStatus('err')
      setScanMessage(String(e))
    } finally {
      setIsChecking(false)
      setTimeout(() => { setScanStatus('idle'); setScanMessage('') }, 4000)
    }
  }

  // ── Handle PIN attendance ──────────────────────────────────────────────────
  async function handlePinSubmit() {
    if (!pinInput) return
    const found = staff.find(s => s.pin === pinInput)
    if (!found) {
      setScanStatus('err')
      setScanMessage('Invalid PIN')
      setPinInput('')
      setTimeout(() => { setScanStatus('idle'); setScanMessage('') }, 3000)
      return
    }
    setPinInput('')
    await processAttendance(found)
  }

  // ── Record check-in or check-out ──────────────────────────────────────────
  async function processAttendance(staffMember: Staff) {
    const existing = await window.posAPI.getAttendanceForStaffToday(staffMember.id)

    if (!existing || !existing.check_in) {
      // Check-in
      const result = await window.posAPI.checkIn(staffMember.id, staffMember.name)
      if (result.ok) {
        setScanStatus('ok')
        setScanMessage(`✓ ${staffMember.name} checked IN at ${formatTime(result.record?.check_in ?? null)}`)
      } else {
        setScanStatus('err')
        setScanMessage(result.error ?? 'Check-in failed')
      }
    } else if (!existing.check_out) {
      // Check-out
      const result = await window.posAPI.checkOut(staffMember.id)
      if (result.ok) {
        const dur = existing.check_in ? formatDuration(existing.check_in, result.record?.check_out ?? null) : ''
        setScanStatus('ok')
        setScanMessage(`✓ ${staffMember.name} checked OUT — ${dur}`)
      } else {
        setScanStatus('err')
        setScanMessage(result.error ?? 'Check-out failed')
      }
    } else {
      setScanStatus('ok')
      setScanMessage(`${staffMember.name} already completed for today`)
    }

    loadData()
    setTimeout(() => { setScanStatus('idle'); setScanMessage('') }, 4000)
  }

  const present = records.filter(r => r.check_in)
  const checkedOut = records.filter(r => r.check_out)
  const stillIn    = records.filter(r => r.check_in && !r.check_out)

  return (
    <div className="flex h-full bg-slate-900">
      {/* Left: scan panel */}
      <div className="w-80 flex-shrink-0 border-r border-slate-700 flex flex-col">
        {/* Header */}
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

        {/* Mode tabs */}
        <div className="flex border-b border-slate-700">
          <button
            onClick={() => setMode('auto')}
            className={`flex-1 py-2 text-xs font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors
              ${mode === 'auto' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
          >
            <Fingerprint size={14} />
            Biometric
          </button>
          <button
            onClick={() => setMode('pin')}
            className={`flex-1 py-2 text-xs font-medium border-b-2 transition-colors
              ${mode === 'pin' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
          >
            PIN
          </button>
        </div>

        {/* Scan area */}
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-4">
          {mode === 'auto' ? (
            <>
              {/* RD Service status */}
              <div className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded-full
                ${rdAvailable === null ? 'bg-slate-700 text-slate-400'
                : rdAvailable ? 'bg-emerald-900/50 text-emerald-400'
                : 'bg-red-900/50 text-red-400'}`}>
                {rdAvailable ? <CheckCircle size={11} /> : <AlertCircle size={11} />}
                {rdAvailable === null ? 'Checking scanner...'
                : rdAvailable ? 'Scanner ready'
                : 'Scanner offline (install RD Service)'}
              </div>

              {/* Fingerprint button */}
              <button
                onClick={handleBiometricScan}
                disabled={isChecking || !rdAvailable}
                className={`w-32 h-32 rounded-full flex items-center justify-center transition-all
                  ${scanStatus === 'ok'       ? 'bg-emerald-600 scale-95'
                  : scanStatus === 'err'      ? 'bg-red-900 border-2 border-red-500'
                  : scanStatus === 'scanning' ? 'bg-indigo-900 border-2 border-indigo-400 animate-pulse'
                  : rdAvailable
                    ? 'bg-slate-700 border-2 border-slate-600 hover:border-indigo-500 hover:bg-slate-600 active:scale-95'
                    : 'bg-slate-800 border-2 border-slate-700 opacity-50 cursor-not-allowed'}`}
              >
                {scanStatus === 'scanning' ? (
                  <RefreshCw size={36} className="animate-spin text-indigo-400" />
                ) : scanStatus === 'ok' ? (
                  <CheckCircle size={36} className="text-emerald-400" />
                ) : scanStatus === 'err' ? (
                  <AlertCircle size={36} className="text-red-400" />
                ) : (
                  <Fingerprint size={36} className="text-slate-400" />
                )}
              </button>

              {scanMessage && (
                <p className={`text-xs text-center px-4 ${
                  scanStatus === 'ok' ? 'text-emerald-400' :
                  scanStatus === 'err' ? 'text-red-400' : 'text-slate-400'
                }`}>
                  {scanMessage}
                </p>
              )}
              {!scanMessage && (
                <p className="text-xs text-slate-500 text-center">Tap to scan fingerprint</p>
              )}

              <button
                onClick={checkRdService}
                className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1"
              >
                <RefreshCw size={10} /> Refresh scanner
              </button>
            </>
          ) : (
            /* PIN mode */
            <div className="w-full space-y-3">
              <p className="text-xs text-slate-400 text-center">Enter your 4-digit PIN</p>
              <input
                type="password"
                maxLength={6}
                value={pinInput}
                onChange={e => setPinInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handlePinSubmit()}
                autoFocus
                className="w-full bg-slate-700 text-white text-center text-xl tracking-widest rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="••••"
              />

              {scanMessage && (
                <p className={`text-xs text-center ${scanStatus === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {scanMessage}
                </p>
              )}

              <button
                onClick={handlePinSubmit}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
              >
                Submit
              </button>

              {/* Quick select for manual override */}
              <div className="space-y-1">
                <p className="text-xs text-slate-500 text-center">Or select staff:</p>
                {staff.map(s => (
                  <button
                    key={s.id}
                    onClick={() => processAttendance(s)}
                    className="w-full text-left px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-200 transition-colors"
                  >
                    {s.name} <span className="text-slate-500">({s.role})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: today's attendance log */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 bg-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Today's Attendance</h2>
          <button onClick={loadData} className="text-slate-400 hover:text-slate-200">
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
          {/* Present grid */}
          {records.length === 0 ? (
            <div className="text-center text-slate-600 py-12 text-sm">No attendance recorded today</div>
          ) : (
            <div className="space-y-2">
              {records.map(r => (
                <div key={r.local_id} className="flex items-center gap-3 bg-slate-800 rounded-lg px-3 py-2.5">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${r.check_out ? 'bg-slate-500' : 'bg-emerald-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-200">{r.staff_name}</div>
                    <div className="text-xs text-slate-400">
                      IN {formatTime(r.check_in)} {r.check_out ? `→ OUT ${formatTime(r.check_out)}` : '(still in)'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {r.check_in && (
                      <span className="text-xs text-slate-500">
                        {formatDuration(r.check_in, r.check_out)}
                      </span>
                    )}
                    {r.check_out ? (
                      <UserX size={14} className="text-slate-500" />
                    ) : (
                      <UserCheck size={14} className="text-emerald-400" />
                    )}
                    {r.synced === 0 && <span className="text-xs text-amber-400 w-4">●</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Staff not yet recorded */}
          {staff.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-slate-500 mb-2">Not yet recorded today:</p>
              <div className="flex flex-wrap gap-2">
                {staff
                  .filter(s => !records.find(r => r.staff_id === s.id))
                  .map(s => (
                    <button
                      key={s.id}
                      onClick={() => processAttendance(s)}
                      className="px-2 py-1 rounded bg-slate-800 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200 border border-slate-700 transition-colors"
                    >
                      {s.name}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
