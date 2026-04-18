'use client'
import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Camera, Trash2, X, ShieldAlert, Users, Clock, BarChart2, UserCheck } from 'lucide-react'
import { captureFaceSample, ensureFaceModelsLoaded, type FaceCaptureSample } from '../../../lib/face-client'

type Tab = 'directory' | 'attendance' | 'billing'

const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'bg-indigo-100 text-indigo-700',
  CASHIER: 'bg-blue-100 text-blue-700',
  SUPPLIER: 'bg-amber-100 text-amber-700',
  HELPER: 'bg-green-100 text-green-700',
  CLEANER: 'bg-teal-100 text-teal-700',
  WATCHMAN: 'bg-orange-100 text-orange-700',
  COLLECTOR: 'bg-purple-100 text-purple-700',
  OTHER: 'bg-slate-100 text-slate-500',
}

export default function StaffPage() {
  const { data: session } = useSession()
  const user = session?.user as { id?: string; name?: string; role?: string } | undefined
  const [tab, setTab] = useState<Tab>('directory')

  // ── Staff list ─────────────────────────────────────────────────────────────
  const [staff, setStaff] = useState<any[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<any>({
    name: '', email: '', pin: '', role: 'SUPPLIER', payrollType: 'SALARY',
    monthlySalary: '', dailyWage: '', expectedCheckIn: '', expectedCheckOut: '', lateGraceMinutes: 15,
  })
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const [editingStaffId, setEditingStaffId] = useState<number | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)

  // ── Attendance metrics ─────────────────────────────────────────────────────
  const [metricsFrom, setMetricsFrom] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10))
  const [metricsTo, setMetricsTo] = useState(new Date().toISOString().slice(0, 10))
  const [metricsData, setMetricsData] = useState<any[]>([])
  const [metricsLoading, setMetricsLoading] = useState(false)

  // ── Clerk billing ──────────────────────────────────────────────────────────
  const [billingDate, setBillingDate] = useState(new Date().toISOString().slice(0, 10))
  const [billingData, setBillingData] = useState<any[]>([])
  const [billingLoading, setBillingLoading] = useState(false)

  // ── Face enrollment ────────────────────────────────────────────────────────
  const [faceReady, setFaceReady] = useState(false)
  const [faceModelMessage, setFaceModelMessage] = useState('Loading face models...')
  const [faceModalOpen, setFaceModalOpen] = useState(false)
  const [faceEnrollmentStaff, setFaceEnrollmentStaff] = useState<any | null>(null)
  const [faceSamples, setFaceSamples] = useState<FaceCaptureSample[]>([])
  const [faceCaptureStatus, setFaceCaptureStatus] = useState<'idle' | 'loading' | 'ready' | 'saving' | 'error'>('idle')
  const [faceCaptureMessage, setFaceCaptureMessage] = useState('')
  const faceVideoRef = useRef<HTMLVideoElement | null>(null)
  const faceStreamRef = useRef<MediaStream | null>(null)

  async function loadStaff() {
    setStaff(await fetch('/api/staff').then(r => r.json()))
  }

  async function loadMetrics() {
    setMetricsLoading(true)
    try {
      const res = await fetch(`/api/attendance/metrics?from=${metricsFrom}&to=${metricsTo}`)
      const data = await res.json()
      setMetricsData(Array.isArray(data) ? data : [])
    } catch {
      setMetricsData([])
    } finally {
      setMetricsLoading(false)
    }
  }

  async function loadBilling() {
    setBillingLoading(true)
    try {
      const res = await fetch(`/api/clerk-billing?date=${billingDate}`)
      const data = await res.json()
      setBillingData(Array.isArray(data) ? data : [])
    } catch {
      setBillingData([])
    } finally {
      setBillingLoading(false)
    }
  }

  useEffect(() => { loadStaff() }, [])
  useEffect(() => {
    if (tab === 'attendance') loadMetrics()
    if (tab === 'billing') loadBilling()
  }, [tab])

  useEffect(() => {
    ensureFaceModelsLoaded()
      .then(() => { setFaceReady(true); setFaceModelMessage('Face models ready') })
      .catch(e => { setFaceReady(false); setFaceModelMessage(e instanceof Error ? e.message : 'Unable to load face models') })
  }, [])

  // ── Staff CRUD ─────────────────────────────────────────────────────────────
  async function submitStaff(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setFormError('')
    try {
      if (form.role === 'CASHIER') {
        if (!form.pin || String(form.pin).length !== 4) {
          setFormError('Cashiers must have a 4-digit PIN'); setLoading(false); return
        }
      }
      const payload: any = {
        name: form.name, email: form.email || null, role: form.role, payrollType: form.payrollType,
        monthlySalary: form.monthlySalary ? Number(form.monthlySalary) : undefined,
        dailyWage: form.dailyWage ? Number(form.dailyWage) : undefined,
        expectedCheckIn: form.expectedCheckIn || null, expectedCheckOut: form.expectedCheckOut || null,
        lateGraceMinutes: Number(form.lateGraceMinutes) || 15,
      }
      if (form.role === 'CASHIER') payload.pin = form.pin

      const res = editingStaffId
        ? await fetch('/api/staff', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editingStaffId, ...payload }) })
        : await fetch('/api/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })

      const data = await res.json()
      setLoading(false)
      if (res.ok) {
        setShowAdd(false); setEditingStaffId(null)
        setForm({ name: '', email: '', pin: '', role: 'SUPPLIER', payrollType: 'SALARY', monthlySalary: '', dailyWage: '', expectedCheckIn: '', expectedCheckOut: '', lateGraceMinutes: 15 })
        loadStaff()
      } else {
        setFormError(data.error ?? 'Failed to save staff')
      }
    } catch (error: any) {
      setLoading(false); setFormError(error?.message || 'Unknown error')
    }
  }

  async function toggleActive(id: number, active: boolean) {
    await fetch('/api/staff', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, active: !active }) })
    loadStaff()
  }

  function openEdit(s: any) {
    setEditingStaffId(s.id)
    setForm({
      name: s.name || '', email: s.email || '', pin: s.pin || '', role: s.role || 'SUPPLIER',
      payrollType: s.payrollType || 'SALARY', monthlySalary: s.monthlySalary ? String(s.monthlySalary) : '',
      dailyWage: s.dailyWage ? String(s.dailyWage) : '', expectedCheckIn: s.expectedCheckIn || '',
      expectedCheckOut: s.expectedCheckOut || '', lateGraceMinutes: s.lateGraceMinutes ?? 15,
    })
    setShowAdd(true)
  }

  function openDelete(s: any) {
    setDeleteConfirmId(s.id)
    setDeleteError('')
  }

  async function confirmDelete() {
    if (!deleteConfirmId) return
    setDeleteLoading(true); setDeleteError('')
    try {
      const res = await fetch('/api/staff', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteConfirmId }),
      })
      const data = await res.json()
      if (res.ok) {
        setDeleteConfirmId(null)
        loadStaff()
      } else {
        setDeleteError(data.error ?? 'Failed to delete')
      }
    } catch {
      setDeleteError('Network error')
    } finally {
      setDeleteLoading(false)
    }
  }

  // ── Face enrollment ────────────────────────────────────────────────────────
  function resetFaceModal() {
    setFaceSamples([]); setFaceCaptureStatus('idle'); setFaceCaptureMessage('')
    setFaceEnrollmentStaff(null); setFaceModalOpen(false)
    try { faceStreamRef.current?.getTracks().forEach(t => t.stop()) } catch { }
    faceStreamRef.current = null
    if (faceVideoRef.current) faceVideoRef.current.srcObject = null
  }

  async function openFaceEnrollment(s: any) {
    setFaceEnrollmentStaff(s); setFaceSamples([]); setFaceCaptureStatus('idle')
    setFaceCaptureMessage('Starting camera…'); setFaceModalOpen(true)
    setTimeout(() => startFaceCamera(), 80)
  }

  async function startFaceCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      faceStreamRef.current = stream
      if (faceVideoRef.current) faceVideoRef.current.srcObject = stream
      setFaceCaptureStatus('ready')
      setFaceCaptureMessage('Camera ready. Capture 3–5 samples, slightly varying your angle each time.')
    } catch {
      setFaceCaptureStatus('error'); setFaceCaptureMessage('Could not access camera — check browser permissions.')
    }
  }

  async function captureFaceEnrollmentSample() {
    if (!faceVideoRef.current || !faceReady) { setFaceCaptureStatus('error'); setFaceCaptureMessage(faceModelMessage); return }
    if (faceSamples.length >= 5) { setFaceCaptureStatus('ready'); setFaceCaptureMessage('Maximum of 5 samples reached.'); return }
    if (!faceStreamRef.current || faceVideoRef.current.readyState < 2) { setFaceCaptureStatus('error'); setFaceCaptureMessage('Camera not ready — try pressing "Retry camera".'); return }
    setFaceCaptureStatus('loading'); setFaceCaptureMessage('Analyzing face…')
    try {
      const sample = await captureFaceSample(faceVideoRef.current)
      setFaceSamples(prev => {
        const next = [...prev, sample]
        setFaceCaptureMessage(`Sample ${next.length}/5 captured.${next.length < 3 ? ` Need ${3 - next.length} more.` : ' You can save now.'}`)
        return next
      })
      setFaceCaptureStatus('ready')
    } catch (error: any) {
      setFaceCaptureStatus('error'); setFaceCaptureMessage(error?.message ?? 'Failed to capture face sample')
    }
  }

  async function saveFaceEnrollment() {
    if (!faceEnrollmentStaff || faceSamples.length < 3) { setFaceCaptureStatus('error'); setFaceCaptureMessage('Capture at least 3 samples.'); return }
    setFaceCaptureStatus('saving'); setFaceCaptureMessage('Saving face profile...')
    try {
      const res = await fetch('/api/staff/face', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId: faceEnrollmentStaff.id, samples: faceSamples.map(s => ({ descriptor: s.descriptor, detectionScore: s.detectionScore, qualityScore: s.qualityScore })), replaceExisting: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to save face profile')
      setFaceCaptureStatus('ready'); setFaceCaptureMessage(data.message ?? 'Face profile saved')
      await loadStaff()
      setTimeout(() => resetFaceModal(), 1200)
    } catch (error: any) {
      setFaceCaptureStatus('error'); setFaceCaptureMessage(error?.message ?? 'Failed to save face profile')
    }
  }

  async function clearFaceEnrollment(staffId: number) {
    if (!confirm('Remove all face samples for this staff member?')) return
    await fetch('/api/staff/face', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId }) })
    await loadStaff()
  }

  if (user?.role !== 'ADMIN') return (
    <div className="p-8 text-center text-gray-400">
      <div className="text-4xl mb-3">🔒</div>
      <p>Admin access required</p>
    </div>
  )

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'directory', label: 'Staff Directory', icon: <Users size={15} /> },
    { id: 'attendance', label: 'Attendance', icon: <Clock size={15} /> },
    { id: 'billing', label: 'Clerk Billing', icon: <BarChart2 size={15} /> },
  ]

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff</h1>
          <p className="text-sm text-gray-500 mt-0.5">{staff.length} members · {staff.filter(s => s.active).length} active</p>
        </div>
        {tab === 'directory' && (
          <button
            onClick={() => { setEditingStaffId(null); setForm({ name: '', email: '', pin: '', role: 'SUPPLIER', payrollType: 'SALARY', monthlySalary: '', dailyWage: '', expectedCheckIn: '', expectedCheckOut: '', lateGraceMinutes: 15 }); setShowAdd(true) }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors text-sm"
          >
            + Add Staff
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── Staff Directory ── */}
      {tab === 'directory' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Role</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Payroll</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Schedule</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Face</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {staff.map((s: any) => {
                const enrolledSamples = s.faceProfile?.sampleCount ?? 0
                return (
                  <tr key={s.id} className={!s.active ? 'opacity-50 bg-gray-50/50' : 'hover:bg-gray-50/50'}>
                    <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{s.email || <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${ROLE_COLORS[s.role] ?? ROLE_COLORS.OTHER}`}>
                        {s.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="text-xs font-medium text-gray-700">{s.payrollType || '—'}</div>
                      {s.payrollType === 'SALARY' && s.monthlySalary && <div className="text-[10px] text-gray-500">₹{s.monthlySalary}/mo</div>}
                      {s.payrollType === 'DAILY' && s.dailyWage && <div className="text-[10px] text-gray-500">₹{s.dailyWage}/day</div>}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-gray-500">
                      {s.expectedCheckIn || s.expectedCheckOut ? (
                        <div className="space-y-0.5">
                          {s.expectedCheckIn && <div>In: <span className="font-medium text-gray-700">{s.expectedCheckIn}</span></div>}
                          {s.expectedCheckOut && <div>Out: <span className="font-medium text-gray-700">{s.expectedCheckOut}</span></div>}
                          <div className="text-[10px] text-gray-400">{s.lateGraceMinutes ?? 15}m grace</div>
                        </div>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-center gap-1.5">
                        {enrolledSamples > 0 ? (
                          <span className="text-emerald-600 font-bold text-[11px] flex items-center gap-1">
                            <Camera size={12} />{enrolledSamples}/5 enrolled
                          </span>
                        ) : (
                          <span className="text-gray-400 text-[11px]">No face</span>
                        )}
                        <div className="flex gap-1 flex-wrap justify-center">
                          <button onClick={() => openFaceEnrollment(s)} className="text-[11px] px-2 py-0.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium">
                            {enrolledSamples > 0 ? 'Re-enroll' : '+ Enroll'}
                          </button>
                          {enrolledSamples > 0 && (
                            <button onClick={() => clearFaceEnrollment(s.id)} className="text-[11px] px-2 py-0.5 bg-red-50 text-red-500 rounded-md hover:bg-red-100 font-medium flex items-center gap-0.5">
                              <Trash2 size={10} />Clear
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${s.active ? 'bg-emerald-400' : 'bg-gray-300'}`} />
                        <span className={`text-xs font-medium ${s.active ? 'text-emerald-600' : 'text-gray-400'}`}>{s.active ? 'Active' : 'Inactive'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(s)} className="text-xs px-3 py-1.5 rounded-lg bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200">
                          Edit
                        </button>
                        <button onClick={() => toggleActive(s.id, s.active)} className={`text-xs px-3 py-1.5 rounded-lg font-medium border ${s.active ? 'bg-red-50 text-red-600 hover:bg-red-100 border-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100 border-green-100'}`}>
                          {s.active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button onClick={() => openDelete(s)} className="text-xs px-2 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 flex items-center gap-1">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {staff.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">No staff members yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Attendance Metrics ── */}
      {tab === 'attendance' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">From</label>
              <input type="date" value={metricsFrom} onChange={e => setMetricsFrom(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">To</label>
              <input type="date" value={metricsTo} onChange={e => setMetricsTo(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <button onClick={loadMetrics} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Apply</button>
          </div>

          {metricsLoading ? (
            <div className="py-16 text-center text-gray-400">Loading…</div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Role</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Days Present</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Total Hours</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Avg Hours/Day</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {metricsData.map(row => (
                    <tr key={row.staffId} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-medium text-gray-900">{row.staffName}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${ROLE_COLORS[row.role] ?? ROLE_COLORS.OTHER}`}>
                          {row.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-gray-900">{row.daysPresent}</td>
                      <td className="px-4 py-3 text-center text-gray-700">{row.totalHours}h</td>
                      <td className="px-4 py-3 text-center text-gray-500">{row.avgHours}h</td>
                    </tr>
                  ))}
                  {metricsData.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">No attendance records in this range</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Clerk Billing ── */}
      {tab === 'billing' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Date</label>
              <input type="date" value={billingDate} onChange={e => setBillingDate(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <button onClick={loadBilling} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Apply</button>
          </div>

          {billingLoading ? (
            <div className="py-16 text-center text-gray-400">Loading…</div>
          ) : (
            <div className="space-y-3">
              {billingData.length === 0 ? (
                <div className="py-16 text-center text-gray-400 bg-white rounded-xl border border-gray-200">No billing data for this date</div>
              ) : (
                <>
                  {/* Summary bar */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total Revenue</div>
                      <div className="text-2xl font-bold text-gray-900 mt-1">₹{billingData.reduce((s, r) => s + r.amount, 0).toLocaleString('en-IN')}</div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total Bottles</div>
                      <div className="text-2xl font-bold text-gray-900 mt-1">{billingData.reduce((s, r) => s + r.bottles, 0)}</div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total Bills</div>
                      <div className="text-2xl font-bold text-gray-900 mt-1">{billingData.reduce((s, r) => s + r.bills, 0)}</div>
                    </div>
                  </div>

                  {/* Per-clerk table */}
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="text-left px-4 py-3 font-semibold text-gray-600">Staff</th>
                          <th className="text-center px-4 py-3 font-semibold text-gray-600">Bills</th>
                          <th className="text-center px-4 py-3 font-semibold text-gray-600">Bottles</th>
                          <th className="text-right px-4 py-3 font-semibold text-gray-600">Amount</th>
                          <th className="text-right px-4 py-3 font-semibold text-gray-600">% of Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {billingData.map((row, i) => {
                          const total = billingData.reduce((s, r) => s + r.amount, 0)
                          const pct = total > 0 ? ((row.amount / total) * 100).toFixed(1) : '0.0'
                          return (
                            <tr key={i} className="hover:bg-gray-50/50">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center">
                                    <UserCheck size={14} className="text-blue-600" />
                                  </div>
                                  <span className="font-medium text-gray-900">{row.name}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-center text-gray-700">{row.bills}</td>
                              <td className="px-4 py-3 text-center text-gray-700">{row.bottles}</td>
                              <td className="px-4 py-3 text-right font-semibold text-gray-900">₹{Number(row.amount).toLocaleString('en-IN')}</td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <div className="w-20 bg-gray-100 rounded-full h-1.5">
                                    <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="text-xs text-gray-500 w-10 text-right">{pct}%</span>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Add/Edit Staff Modal ── */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-96 shadow-xl">
            <h3 className="font-bold text-gray-900 text-lg mb-5">{editingStaffId ? 'Edit Staff Member' : 'Add Staff Member'}</h3>
            <form onSubmit={submitStaff} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email <span className="text-gray-400 font-normal">(optional)</span></label>
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {form.role === 'CASHIER' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">4-Digit PIN</label>
                    <input value={form.pin} onChange={e => setForm({ ...form, pin: e.target.value.slice(0, 4) })} maxLength={4} inputMode="numeric" placeholder="1234" pattern="[0-9]{4}" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-center font-mono tracking-widest focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                ) : <div />}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="CASHIER">Cashier</option>
                    <option value="SUPPLIER">Supplier</option>
                    <option value="HELPER">Helper</option>
                    <option value="CLEANER">Cleaner</option>
                    <option value="WATCHMAN">Watchman</option>
                    <option value="COLLECTOR">Collector</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payroll</label>
                <div className="flex gap-2">
                  <select value={form.payrollType} onChange={e => setForm({ ...form, payrollType: e.target.value })} className="w-1/2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="SALARY">Fixed Monthly</option>
                    <option value="DAILY">Daily Wage</option>
                  </select>
                  {form.payrollType === 'SALARY'
                    ? <input value={form.monthlySalary} onChange={e => setForm({ ...form, monthlySalary: e.target.value })} placeholder="Monthly ₹" inputMode="decimal" className="w-1/2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    : <input value={form.dailyWage} onChange={e => setForm({ ...form, dailyWage: e.target.value })} placeholder="Per-day ₹" inputMode="decimal" className="w-1/2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Schedule</label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Check-in</label>
                    <input type="time" value={form.expectedCheckIn} onChange={e => setForm({ ...form, expectedCheckIn: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Check-out</label>
                    <input type="time" value={form.expectedCheckOut} onChange={e => setForm({ ...form, expectedCheckOut: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                </div>
                <div className="mt-2">
                  <label className="block text-xs text-gray-500 mb-1">Grace window (minutes)</label>
                  <input type="number" min={0} max={60} value={form.lateGraceMinutes} onChange={e => setForm({ ...form, lateGraceMinutes: Number(e.target.value) })} className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              {formError && <p className="text-xs text-red-500 font-medium">{formError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowAdd(false); setEditingStaffId(null) }} className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={loading} className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {loading ? 'Saving...' : editingStaffId ? 'Save Changes' : 'Add Staff'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-80 shadow-xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Delete Staff Member</h3>
                <p className="text-xs text-gray-500">
                  {staff.find(s => s.id === deleteConfirmId)?.name}
                </p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              This will permanently remove this staff member. If they have existing sales or receipts, you will need to <strong>deactivate</strong> them instead.
            </p>
            {deleteError && <p className="text-xs text-red-500 mb-3 font-medium">{deleteError}</p>}
            <div className="flex gap-3">
              <button onClick={() => { setDeleteConfirmId(null); setDeleteError('') }} className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 text-sm">Cancel</button>
              <button onClick={confirmDelete} disabled={deleteLoading} className="flex-1 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm font-medium">
                {deleteLoading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Face Enrollment Modal ── */}
      {faceModalOpen && faceEnrollmentStaff && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-slate-950 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Face Enrollment</h3>
                <p className="text-xs text-slate-400">{faceEnrollmentStaff.name} · {faceEnrollmentStaff.role}</p>
              </div>
              <button onClick={resetFaceModal} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
              <div className="p-5 space-y-4 border-b lg:border-b-0 lg:border-r border-slate-800">
                <div className="bg-slate-900 rounded-xl border border-slate-700 p-4 text-xs text-slate-300 space-y-2">
                  <div className="font-bold text-slate-100 uppercase tracking-widest flex items-center gap-2"><ShieldAlert size={12} />Quality rules</div>
                  <ul className="list-disc pl-4 space-y-1 text-slate-400">
                    <li>Capture at least 3 samples.</li>
                    <li>Keep one face in frame, centered, and well lit.</li>
                    <li>Vary angle slightly between captures.</li>
                  </ul>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={captureFaceEnrollmentSample} disabled={!faceReady || faceCaptureStatus === 'loading' || faceSamples.length >= 5} className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 font-medium">
                    {faceCaptureStatus === 'loading' ? 'Capturing…' : 'Capture sample'}
                  </button>
                  <button onClick={() => setFaceSamples(prev => prev.slice(0, -1))} disabled={faceSamples.length === 0} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:opacity-50 font-medium">
                    Remove last
                  </button>
                  {!faceStreamRef.current && (
                    <button onClick={startFaceCamera} className="px-4 py-2 rounded-lg bg-slate-700 text-slate-100 hover:bg-slate-600 font-medium">Retry camera</button>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">{faceModelMessage}</p>
                <p className={`text-xs ${faceCaptureStatus === 'error' ? 'text-red-400' : faceCaptureStatus === 'saving' ? 'text-amber-300' : 'text-slate-300'}`}>
                  {faceCaptureMessage || 'No samples captured yet.'}
                </p>
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <Camera size={14} className="text-indigo-400" />
                  Captured {faceSamples.length}/5 samples
                </div>
                <video ref={faceVideoRef} autoPlay playsInline muted className="w-full aspect-video bg-black rounded-xl object-cover border border-slate-700" />
              </div>
              <div className="p-5 space-y-4 bg-slate-950/60">
                <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Captured samples</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[320px] overflow-auto pr-1">
                  {faceSamples.length === 0 ? (
                    <div className="col-span-full text-sm text-slate-500 border border-dashed border-slate-700 rounded-xl p-4 text-center">Samples will appear here after capture.</div>
                  ) : faceSamples.map((sample, index) => (
                    <div key={`${index}-${sample.detectionScore}`} className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
                      <img src={sample.previewDataUrl} alt={`Face sample ${index + 1}`} className="w-full h-40 object-cover" />
                      <div className="p-3 text-xs text-slate-300 space-y-1">
                        <div className="font-semibold text-slate-100">Sample {index + 1}</div>
                        <div>Detection: {Math.round(sample.detectionScore * 100)}%</div>
                        <div>Quality: {Math.round(sample.qualityScore * 100)}%</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={saveFaceEnrollment} disabled={faceCaptureStatus === 'saving' || faceSamples.length < 3} className="flex-1 py-2.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 font-semibold">
                    {faceCaptureStatus === 'saving' ? 'Saving...' : 'Save face profile'}
                  </button>
                  <button onClick={resetFaceModal} className="px-4 py-2.5 rounded-lg bg-slate-800 text-slate-100 hover:bg-slate-700 font-semibold">Close</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
