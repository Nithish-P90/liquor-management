'use client'
import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'

type StaffStatus = {
  staffId:     number
  staffName:   string
  role:        string
  checkIn:     string | null
  checkOut:    string | null
  hoursWorked: number | null
  status:      'IN' | 'OUT' | 'ABSENT'
  scanCount:   number // 0, 1, or 2
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

// ── beep helpers ───────────────────────────────────────────────────────────────
function beep(type: 'ok' | 'err') {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = ctx.createOscillator()
    osc.type = type === 'ok' ? 'sine' : 'sawtooth'
    osc.frequency.setValueAtTime(type === 'ok' ? 1200 : 200, ctx.currentTime)
    osc.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + (type === 'ok' ? 0.12 : 0.35))
  } catch { /* Audio not available */ }
}

export default function AttendancePage() {
  const { data: session } = useSession()
  const user = session?.user as { id?: string; name?: string; role?: string } | undefined
  const isAdmin = user?.role === 'ADMIN'

  const [status,       setStatus]       = useState<StaffStatus[]>([])
  const [scanning,     setScanning]     = useState(false)
  const [scanResult,   setScanResult]   = useState<ScanResult>(null)
  const [viewDate]     = useState(new Date().toISOString().slice(0, 10))
  const [loading,      setLoading]      = useState(true)

  // PIN fallback
  const [showPin,      setShowPin]      = useState(false)
  const [pinStaffId,   setPinStaffId]   = useState<number | ''>('')
  const [pin,          setPin]          = useState('')
  const [pinLoading,   setPinLoading]   = useState(false)

  const loadStatus = useCallback(async (date?: string) => {
    setLoading(true)
    try {
      const d = date ?? viewDate
      const data = await fetch(`/api/attendance?date=${d}`).then(r => r.json())
      setStatus(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [viewDate])

  useEffect(() => { loadStatus(viewDate) }, [viewDate, loadStatus])

  // Auto-refresh every 30 s while page is open
  useEffect(() => {
    const id = setInterval(() => loadStatus(viewDate), 30_000)
    return () => clearInterval(id)
  }, [viewDate, loadStatus])

  // ── Fingerprint scan ─────────────────────────────────────────────────────────
  async function fingerprintScan() {
    setScanning(true)
    setScanResult(null)

    try {
      // Port scan using plain GET (avoids CORS preflight on non-standard methods)
      let activePort = null
      for (let port = 11100; port <= 11105; port++) {
        try {
          const check = await fetch(`http://127.0.0.1:${port}/rd/info`)
          if (check.ok) { activePort = port; break }
        } catch { continue }
      }

      if (!activePort) {
        throw new Error('Bridge not running. Open a terminal and run: npm run fingerprint-bridge')
      }

      // text/plain is a CORS "simple" content-type — no preflight request needed
      const xml = `<?xml version="1.0"?><PidOptions ver="1.0"><Opts fCount="1" fType="0" iCount="0" pCount="0" format="0" pidVer="2.0" timeout="10000" otp="" wadh="" posh=""/></PidOptions>`
      const capture = await fetch(`http://127.0.0.1:${activePort}/rd/capture`, {
        method:  'POST',
        headers: { 'Content-Type': 'text/plain' },
        body:    xml,
      })
      const template = await capture.text()

      const res  = await fetch('/api/attendance', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ template }),
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Matching failed')

      beep('ok')
      const label =
        data.type === 'CHECK_IN'    ? `Clocked IN  · ${fmtTime(data.time)}`
        : data.type === 'CHECK_OUT' ? `Clocked OUT · ${fmtTime(data.time)}`
        :                              `Success · ${fmtTime(data.time)}`

      setScanResult({ text: `${data.staff} — ${label}`, type: 'success' })
      loadStatus(viewDate)
    } catch (e: any) {
      beep('err')
      setScanResult({
        text: e.message?.includes('fetch') || e.message?.includes('Failed')
          ? 'Scanner not detected. Verify CSD200 connection and RD Service.'
          : (e.message ?? 'Unknown error'),
        type: 'error',
      })
    } finally {
      setScanning(false)
    }
  }

  // ── PIN submit ───────────────────────────────────────────────────────────────
  async function submitPin(e: React.FormEvent) {
    e.preventDefault()
    if (!pinStaffId || pin.length !== 4) return
    setPinLoading(true)
    setScanResult(null)

    try {
      const res  = await fetch('/api/attendance', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ staffId: pinStaffId, pin }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      beep('ok')
      setScanResult({ text: `${data.staff} — Clocked ${data.type === 'CHECK_OUT' ? 'OUT' : 'IN'} · ${fmtTime(data.time)}`, type: 'success' })
      setShowPin(false)
      setPinStaffId('')
      setPin('')
      loadStatus(viewDate)
    } catch (e: any) {
      beep('err')
      setScanResult({ text: e.message ?? 'Invalid PIN', type: 'error' })
    } finally {
      setPinLoading(false)
    }
  }

  const presentCount = status.filter(s => s.status === 'IN').length
  const totalCount   = status.length
  const isToday      = viewDate === new Date().toISOString().slice(0, 10)

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">

      <div className="grid grid-cols-3 gap-6">
        {/* ── Clock-in terminal (left col) ────────────────────────────────── */}
        <div className="col-span-1 space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center shadow-sm">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-5">
              Clock In / Out
            </p>

            {/* Fingerprint button */}
            <div className="relative flex justify-center mb-5">
              <div className={`absolute inset-0 bg-blue-100 rounded-full blur-2xl scale-150 opacity-0 transition-opacity duration-500 ${scanning ? 'opacity-60 animate-pulse' : ''}`} />
              <button
                onClick={fingerprintScan}
                disabled={scanning}
                className={`relative z-10 w-28 h-28 rounded-full border-4 flex items-center justify-center transition-all duration-200 ${
                  scanning
                    ? 'border-blue-400 bg-blue-50 text-blue-500 scale-105'
                    : 'border-gray-200 bg-white text-gray-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50 active:scale-95'
                }`}
              >
                <FingerprintIcon className="w-14 h-14" />
              </button>
            </div>

            <p className="text-xs text-gray-400 mb-4">
              {scanning ? 'Scanning…' : 'Place thumb on sensor'}
            </p>

            {/* Scan result */}
            {scanResult && (
              <div className={`rounded-xl px-4 py-3 text-sm font-semibold mb-4 ${
                scanResult.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {scanResult.type === 'success' ? '✓ ' : '✗ '}{scanResult.text}
              </div>
            )}

            {/* PIN fallback */}
            <button
              onClick={() => setShowPin(v => !v)}
              className="text-xs text-gray-400 hover:text-blue-600 underline underline-offset-2 transition-colors"
            >
              {showPin ? 'Hide PIN entry' : 'Use PIN instead'}
            </button>

            {showPin && (
              <form onSubmit={submitPin} className="mt-4 space-y-3 text-left">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Staff</label>
                  <select
                    value={pinStaffId}
                    onChange={e => setPinStaffId(+e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="">Select…</option>
                    {status.map(s => (
                      <option key={s.staffId} value={s.staffId}>{s.staffName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">4-Digit PIN</label>
                  <input
                    type="password"
                    value={pin}
                    onChange={e => setPin(e.target.value.slice(0, 4))}
                    maxLength={4}
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    required
                    placeholder="••••"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-center font-mono tracking-[0.5em] focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={pinLoading}
                  className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  {pinLoading ? 'Verifying…' : 'Mark Attendance'}
                </button>
              </form>
            )}
          </div>

          {/* Hardware note (admin only) */}
          {isAdmin && (
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-[11px] text-slate-500 space-y-2">
              <div className="font-bold text-slate-700 uppercase tracking-tighter">Hardware Configuration</div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>CSD200 Precision Scanner (CS-200)</span>
              </div>
              <div className="pl-4 border-l-2 border-slate-200 py-1">
                Autoscan active: 11100–11105<br />
                Protocol: RD Service 2.0
              </div>
            </div>
          )}
        </div>

        {/* ── Status board (right 2 cols) ──────────────────────────────────── */}
        <div className="col-span-2 space-y-4">
          {/* Summary pills */}
          <div className="flex gap-3">
            <div className="flex-1 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
              <div className="text-2xl font-black text-emerald-700">{presentCount}</div>
              <div className="text-xs font-semibold text-emerald-600 mt-0.5">Currently In</div>
            </div>
            <div className="flex-1 bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
              <div className="text-2xl font-black text-blue-700">
                {status.filter(s => s.status === 'OUT').length}
              </div>
              <div className="text-xs font-semibold text-blue-600 mt-0.5">Checked Out</div>
            </div>
            <div className="flex-1 bg-gray-100 border border-gray-200 rounded-xl p-3 text-center">
              <div className="text-2xl font-black text-gray-500">
                {status.filter(s => s.status === 'ABSENT').length}
              </div>
              <div className="text-xs font-semibold text-gray-500 mt-0.5">Not In Yet</div>
            </div>
            <div className="flex-1 bg-white border border-gray-200 rounded-xl p-3 text-center">
              <div className="text-2xl font-black text-gray-700">{totalCount}</div>
              <div className="text-xs font-semibold text-gray-500 mt-0.5">Total Staff</div>
            </div>
          </div>

          {/* Staff grid */}
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
                      <td colSpan={5} className="text-center py-8 text-gray-400">
                        No active staff found.
                      </td>
                    </tr>
                  )}
                  {status.map(s => (
                    <tr
                      key={s.staffId}
                      className={`transition-colors ${
                        s.status === 'IN'     ? 'bg-emerald-50/40'
                        : s.status === 'OUT'  ? 'bg-blue-50/20'
                        :                       ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900">{s.staffName}</div>
                        <div className="text-xs text-gray-400">{s.role}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <div className="flex gap-1">
                            <div className={`w-3 h-1.5 rounded-full ${s.scanCount >= 1 ? 'bg-emerald-500 shadow-sm shadow-emerald-200' : 'bg-gray-200'}`} />
                            <div className={`w-3 h-1.5 rounded-full ${s.scanCount >= 2 ? 'bg-emerald-500 shadow-sm shadow-emerald-200' : 'bg-gray-200'}`} />
                          </div>
                          <span className={`text-[10px] font-black ${s.scanCount === 2 ? 'text-emerald-600' : 'text-gray-400'}`}>
                            {s.scanCount}/2
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-gray-600">
                        {fmtTime(s.checkIn)}
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-gray-600">
                        {fmtTime(s.checkOut)}
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-gray-700">
                        {s.status === 'IN' ? (
                          <span className="text-emerald-600">{fmtHours(s.hoursWorked)} ▸</span>
                        ) : (
                          fmtHours(s.hoursWorked)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {status.some(s => s.hoursWorked !== null) && (
                  <tfoot>
                    <tr className="bg-gray-50 border-t border-gray-200">
                      <td colSpan={3} className="px-4 py-2.5 text-xs font-bold text-gray-500">
                        Total man-hours today
                      </td>
                      <td />
                      <td className="px-4 py-2.5 text-center font-black text-gray-800">
                        {fmtHours(
                          status.reduce((sum, s) => sum + (s.hoursWorked ?? 0), 0)
                        )}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {/* Enrollment reminder for admin */}
          {isAdmin && status.some(s => !s.checkIn && s.status === 'ABSENT') && isToday && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
              <span className="font-bold">Absent today: </span>
              {status.filter(s => s.status === 'ABSENT').map(s => s.staffName).join(', ')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Sub-components
function FingerprintIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.4}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.092 2.027-.273 3m-2.755 4.87l.055-.088a13.938 13.938 0 001.486-4.781M9 12a3 3 0 116 0c0 .607-.086 1.196-.246 1.754" />
    </svg>
  )
}
