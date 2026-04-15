'use client'
import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Camera, Trash2, X, ShieldAlert } from 'lucide-react'
import { captureFaceSample, ensureFaceModelsLoaded, type FaceCaptureSample } from '../../../lib/face-client'

export default function StaffPage() {
  const { data: session } = useSession()
  const user = session?.user as { id?: string; name?: string; role?: string } | undefined
  const [staff, setStaff] = useState<any[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<any>({ name: '', email: '', pin: '', role: 'CASHIER', payrollType: 'SALARY', monthlySalary: '', dailyWage: '' })
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const [editingStaffId, setEditingStaffId] = useState<number | null>(null)
  const [showMetrics, setShowMetrics] = useState(false)
  const [metricsFrom, setMetricsFrom] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10))
  const [metricsTo, setMetricsTo] = useState(new Date().toISOString().slice(0, 10))
  const [metricsData, setMetricsData] = useState<any[]>([])
  const [metricsLoading, setMetricsLoading] = useState(false)

  const [faceReady, setFaceReady] = useState(false)
  const [faceModelMessage, setFaceModelMessage] = useState('Loading face models...')
  const [faceModalOpen, setFaceModalOpen] = useState(false)
  const [faceEnrollmentStaff, setFaceEnrollmentStaff] = useState<any | null>(null)
  const [faceSamples, setFaceSamples] = useState<FaceCaptureSample[]>([])
  const [faceCaptureStatus, setFaceCaptureStatus] = useState<'idle' | 'loading' | 'ready' | 'saving' | 'error'>('idle')
  const [faceCaptureMessage, setFaceCaptureMessage] = useState('')
  const faceVideoRef = useRef<HTMLVideoElement | null>(null)
  const faceStreamRef = useRef<MediaStream | null>(null)

  async function load() {
    setStaff(await fetch('/api/staff').then(r => r.json()))
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    ensureFaceModelsLoaded()
      .then(() => {
        setFaceReady(true)
        setFaceModelMessage('Face models ready')
      })
      .catch(error => {
        setFaceReady(false)
        setFaceModelMessage(error instanceof Error ? error.message : 'Unable to load face models')
      })
  }, [])

  async function submitStaff(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setFormError('')
    try {
      if (form.role === 'CASHIER') {
        if (!form.pin || String(form.pin).length !== 4) {
          setFormError('Cashiers must have a 4-digit PIN')
          setLoading(false)
          return
        }
      }

      const payload: any = {
        name: form.name,
        email: form.email || null,
        role: form.role,
        payrollType: form.payrollType,
        monthlySalary: form.monthlySalary ? Number(form.monthlySalary) : undefined,
        dailyWage: form.dailyWage ? Number(form.dailyWage) : undefined,
      }
      if (form.role === 'CASHIER') payload.pin = form.pin

      let res: Response
      if (editingStaffId) {
        res = await fetch('/api/staff', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingStaffId, ...payload }),
        })
      } else {
        res = await fetch('/api/staff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }

      const data = await res.json()
      setLoading(false)
      if (res.ok) {
        setShowAdd(false)
        setEditingStaffId(null)
        setForm({ name: '', email: '', pin: '', role: 'CASHIER', payrollType: 'SALARY', monthlySalary: '', dailyWage: '' })
        load()
      } else {
        setFormError(data.error ?? 'Failed to save staff')
      }
    } catch (error: any) {
      setLoading(false)
      setFormError(error?.message || 'Unknown error')
    }
  }

  async function toggleActive(id: number, active: boolean) {
    await fetch('/api/staff', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active: !active }),
    })
    load()
  }

  function openEdit(s: any) {
    setEditingStaffId(s.id)
    setForm({
      name: s.name || '',
      email: s.email || '',
      pin: s.pin || '',
      role: s.role || 'SUPPLIER',
      payrollType: s.payrollType || 'SALARY',
      monthlySalary: s.monthlySalary ? String(s.monthlySalary) : '',
      dailyWage: s.dailyWage ? String(s.dailyWage) : '',
    })
    setShowAdd(true)
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

  function resetFaceModal() {
    setFaceSamples([])
    setFaceCaptureStatus('idle')
    setFaceCaptureMessage('')
    setFaceEnrollmentStaff(null)
    setFaceModalOpen(false)
    try {
      faceStreamRef.current?.getTracks().forEach(track => track.stop())
    } catch {
      // ignore
    }
    faceStreamRef.current = null
    if (faceVideoRef.current) faceVideoRef.current.srcObject = null
  }

  async function openFaceEnrollment(s: any) {
    setFaceEnrollmentStaff(s)
    setFaceSamples([])
    setFaceCaptureStatus('idle')
    setFaceCaptureMessage('Starting camera…')
    setFaceModalOpen(true)
    // Auto-start camera — wait one tick for the video element to mount
    setTimeout(() => startFaceCamera(), 80)
  }

  async function startFaceCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      faceStreamRef.current = stream
      if (faceVideoRef.current) faceVideoRef.current.srcObject = stream
      setFaceCaptureStatus('ready')
      setFaceCaptureMessage('Camera ready. Capture 3–5 samples, slightly varying your angle each time.')
    } catch {
      setFaceCaptureStatus('error')
      setFaceCaptureMessage('Could not access camera — check browser permissions.')
    }
  }

  function stopFaceCamera() {
    try {
      faceStreamRef.current?.getTracks().forEach(track => track.stop())
    } catch {
      // ignore
    }
    faceStreamRef.current = null
    if (faceVideoRef.current) faceVideoRef.current.srcObject = null
  }

  async function captureFaceEnrollmentSample() {
    if (!faceVideoRef.current) return
    if (!faceReady) {
      setFaceCaptureStatus('error')
      setFaceCaptureMessage(faceModelMessage)
      return
    }
    if (faceSamples.length >= 5) {
      setFaceCaptureStatus('ready')
      setFaceCaptureMessage('Maximum of 5 samples reached. Save or remove one.')
      return
    }
    // Ensure the video stream is actually running
    if (!faceStreamRef.current || faceVideoRef.current.readyState < 2) {
      setFaceCaptureStatus('error')
      setFaceCaptureMessage('Camera not ready — try pressing "Start camera" first.')
      return
    }

    setFaceCaptureStatus('loading')
    setFaceCaptureMessage('Analyzing face…')
    try {
      const sample = await captureFaceSample(faceVideoRef.current)
      setFaceSamples(prev => {
        const next = [...prev, sample]
        setFaceCaptureMessage(`Sample ${next.length}/5 captured.${next.length < 3 ? ` Need ${3 - next.length} more.` : ' You can save now.'}`)
        return next
      })
      setFaceCaptureStatus('ready')
    } catch (error: any) {
      setFaceCaptureStatus('error')
      setFaceCaptureMessage(error?.message ?? 'Failed to capture face sample')
    }
  }

  function removeLastFaceSample() {
    setFaceSamples(prev => prev.slice(0, -1))
    setFaceCaptureStatus('ready')
    setFaceCaptureMessage('Removed last sample.')
  }

  async function saveFaceEnrollment() {
    if (!faceEnrollmentStaff) return
    if (faceSamples.length < 3) {
      setFaceCaptureStatus('error')
      setFaceCaptureMessage('Capture at least 3 samples for a reliable profile.')
      return
    }

    setFaceCaptureStatus('saving')
    setFaceCaptureMessage('Saving face profile...')
    try {
      const res = await fetch('/api/staff/face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffId: faceEnrollmentStaff.id,
          samples: faceSamples.map(sample => ({
            descriptor: sample.descriptor,
            detectionScore: sample.detectionScore,
            qualityScore: sample.qualityScore,
          })),
          replaceExisting: true,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to save face profile')
      setFaceCaptureStatus('ready')
      setFaceCaptureMessage(data.message ?? 'Face profile saved')
      await load()
      setTimeout(() => resetFaceModal(), 1200)
    } catch (error: any) {
      setFaceCaptureStatus('error')
      setFaceCaptureMessage(error?.message ?? 'Failed to save face profile')
    }
  }

  async function clearFaceEnrollment(staffId: number) {
    if (!confirm('Remove all face samples for this staff member?')) return
    await fetch('/api/staff/face', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffId }),
    })
    await load()
  }

  if (user?.role !== 'ADMIN') return (
    <div className="p-8 text-center text-gray-400">
      <div className="text-4xl mb-3">🔒</div>
      <p>Admin access required</p>
    </div>
  )

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Staff Management</h1>
        <div className="flex gap-2">
          <button onClick={() => { setShowMetrics(true); loadMetrics() }} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors">
            Attendance Metrics
          </button>
          <button onClick={() => { setEditingStaffId(null); setForm({ name: '', email: '', pin: '', role: 'CASHIER', payrollType: 'SALARY', monthlySalary: '', dailyWage: '' }); setShowAdd(true) }} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors">
            + Add Staff
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-600">Role</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-600">Payroll</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-600">Face</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {staff.map((s: any) => {
              const enrolledSamples = s.faceProfile?.sampleCount ?? 0
              const faceReadyState = enrolledSamples > 0

              return (
                <tr key={s.id} className={!s.active ? 'opacity-50' : ''}>
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3 text-gray-500">{s.email}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      s.role === 'ADMIN' ? 'bg-indigo-100 text-indigo-700' :
                      s.role === 'CASHIER' ? 'bg-blue-100 text-blue-700' :
                      'bg-slate-100 text-slate-500'
                    }`}>
                      {s.role}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-center">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">{s.payrollType || '—'}</div>
                      {(s.payrollType === 'SALARY' && s.monthlySalary) ? (
                        <div className="text-xs text-gray-500">₹{s.monthlySalary}</div>
                      ) : (s.payrollType === 'DAILY' && s.dailyWage) ? (
                        <div className="text-xs text-gray-500">₹{s.dailyWage}/day</div>
                      ) : null}
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex flex-col items-center gap-1.5 min-w-[180px]">
                      {faceReadyState ? (
                        <span className="text-emerald-600 font-bold text-xs flex items-center gap-1">
                          <Camera size={13} />
                          {enrolledSamples}/5 samples enrolled
                        </span>
                      ) : (
                        <span className="text-gray-400 text-[11px]">No face enrolled</span>
                      )}

                      <div className="flex gap-1 flex-wrap justify-center">
                        <button
                          onClick={() => openFaceEnrollment(s)}
                          className="text-[11px] px-2 py-0.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium transition-colors"
                        >
                          {faceReadyState ? 'Re-enroll face' : '+ Enroll face'}
                        </button>
                        {faceReadyState && (
                          <button
                            onClick={() => clearFaceEnrollment(s.id)}
                            className="text-[11px] px-2 py-0.5 bg-red-50 text-red-500 rounded-md hover:bg-red-100 font-medium inline-flex items-center gap-1"
                          >
                            <Trash2 size={11} />
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => openEdit(s)} className="text-xs px-3 py-1.5 rounded-lg bg-gray-50 text-gray-700 hover:bg-gray-100">Edit</button>
                      <button onClick={() => toggleActive(s.id, s.active)}
                        className={`text-xs px-3 py-1.5 rounded-lg font-medium ${s.active ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}>
                        {s.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

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
                <label className="block text-sm font-medium text-gray-700 mb-1">Email (Optional)</label>
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Only for Admins/Cashiers" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {form.role === 'CASHIER' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">4-Digit PIN</label>
                    <input value={form.pin} onChange={e => setForm({ ...form, pin: e.target.value.slice(0, 4) })} maxLength={4} inputMode="numeric" placeholder="1234" pattern="[0-9]{4}" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-center font-mono tracking-widest focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                ) : (
                  <div />
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rank / Role</label>
                  <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="CASHIER">Cashier</option>
                    <option value="SUPPLIER">Supplier</option>
                    <option value="HELPER">Helper</option>
                    <option value="CLEANER">Cleaner</option>
                    <option value="WATCHMAN">Watchman</option>
                    <option value="LOADER">Loader</option>
                    <option value="COLLECTOR">Collector</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payroll Type</label>
                <div className="flex gap-2">
                  <select value={form.payrollType} onChange={e => setForm({ ...form, payrollType: e.target.value })} className="w-1/2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="SALARY">Fixed Monthly Salary</option>
                    <option value="DAILY">Daily Wage</option>
                  </select>
                  {form.payrollType === 'SALARY' ? (
                    <input value={form.monthlySalary} onChange={e => setForm({ ...form, monthlySalary: e.target.value })} placeholder="Monthly ₹" inputMode="decimal" className="w-1/2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  ) : (
                    <input value={form.dailyWage} onChange={e => setForm({ ...form, dailyWage: e.target.value })} placeholder="Per-day ₹" inputMode="decimal" className="w-1/2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  )}
                </div>
              </div>

              {formError && <p className="text-xs text-red-500 font-medium">{formError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowAdd(false); setEditingStaffId(null) }} className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={loading} className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {loading ? 'Saving...' : (editingStaffId ? 'Save Changes' : 'Add Staff')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showMetrics && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-11/12 max-w-3xl shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900 text-lg">Attendance Metrics</h3>
              <div className="flex items-center gap-2">
                <input type="date" value={metricsFrom} onChange={e => setMetricsFrom(e.target.value)} className="px-3 py-2 border rounded" />
                <input type="date" value={metricsTo} onChange={e => setMetricsTo(e.target.value)} className="px-3 py-2 border rounded" />
                <button onClick={() => loadMetrics()} className="px-3 py-2 bg-blue-600 text-white rounded">Refresh</button>
                <button onClick={() => setShowMetrics(false)} className="px-3 py-2 border rounded">Close</button>
              </div>
            </div>

            {metricsLoading ? (
              <div className="py-8 text-center">Loading…</div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-600">Role</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-600">Days Present</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-600">Total Hours</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-600">Avg Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricsData.map(row => (
                      <tr key={row.staffId} className="odd:bg-white even:bg-gray-50">
                        <td className="px-4 py-3">{row.staffName}</td>
                        <td className="px-4 py-3 text-center">{row.role}</td>
                        <td className="px-4 py-3 text-center font-medium">{row.daysPresent}</td>
                        <td className="px-4 py-3 text-center">{row.totalHours ?? 0}h</td>
                        <td className="px-4 py-3 text-center">{row.avgHours ?? 0}h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {faceModalOpen && faceEnrollmentStaff && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-slate-950 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Face enrollment</h3>
                <p className="text-xs text-slate-400">{faceEnrollmentStaff.name} · {faceEnrollmentStaff.role}</p>
              </div>
              <button onClick={resetFaceModal} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
              <div className="p-5 space-y-4 border-b lg:border-b-0 lg:border-r border-slate-800">
                <div className="bg-slate-900 rounded-xl border border-slate-700 p-4 text-xs text-slate-300 space-y-2">
                  <div className="font-bold text-slate-100 uppercase tracking-widest flex items-center gap-2">
                    <ShieldAlert size={12} />
                    Quality rules
                  </div>
                  <ul className="list-disc pl-4 space-y-1 text-slate-400">
                    <li>Capture at least 3 samples.</li>
                    <li>Keep one face in frame, centered, and well lit.</li>
                    <li>Vary angle slightly between captures for better accuracy.</li>
                  </ul>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={captureFaceEnrollmentSample}
                    disabled={!faceReady || faceCaptureStatus === 'loading' || faceSamples.length >= 5}
                    className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 font-medium"
                  >
                    {faceCaptureStatus === 'loading' ? 'Capturing…' : 'Capture sample'}
                  </button>
                  <button
                    onClick={removeLastFaceSample}
                    disabled={faceSamples.length === 0}
                    className="px-4 py-2 rounded-lg bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:opacity-50 font-medium"
                  >
                    Remove last
                  </button>
                  {/* Fallback in case auto-start failed */}
                  {!faceStreamRef.current && (
                    <button
                      onClick={startFaceCamera}
                      className="px-4 py-2 rounded-lg bg-slate-700 text-slate-100 hover:bg-slate-600 font-medium"
                    >
                      Retry camera
                    </button>
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

                {faceVideoRef.current ? null : null}
                <video ref={faceVideoRef} autoPlay playsInline muted className="w-full aspect-video bg-black rounded-xl object-cover border border-slate-700" />
              </div>

              <div className="p-5 space-y-4 bg-slate-950/60">
                <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Captured samples</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[320px] overflow-auto pr-1">
                  {faceSamples.length === 0 ? (
                    <div className="col-span-full text-sm text-slate-500 border border-dashed border-slate-700 rounded-xl p-4 text-center">
                      Samples will appear here after capture.
                    </div>
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
                  <button
                    onClick={saveFaceEnrollment}
                    disabled={faceCaptureStatus === 'saving' || faceSamples.length < 3}
                    className="flex-1 py-2.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 font-semibold"
                  >
                    {faceCaptureStatus === 'saving' ? 'Saving...' : 'Save face profile'}
                  </button>
                  <button
                    onClick={resetFaceModal}
                    className="px-4 py-2.5 rounded-lg bg-slate-800 text-slate-100 hover:bg-slate-700 font-semibold"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
