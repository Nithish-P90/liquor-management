'use client'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'

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
  const [metricsFrom, setMetricsFrom] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10))
  const [metricsTo, setMetricsTo] = useState(new Date().toISOString().slice(0,10))
  const [metricsData, setMetricsData] = useState<any[]>([])
  const [metricsLoading, setMetricsLoading] = useState(false)

  // Per-staff enrollment state: staffId → { status, message }
  const [enrollStatus, setEnrollStatus] = useState<Record<number, { status: 'scanning' | 'ok' | 'err'; msg: string }>>({})

  async function load() { setStaff(await fetch('/api/staff').then(r => r.json())) }
  useEffect(() => { load() }, [])

  async function submitStaff(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setFormError('')
    try {
      // Client-side validation: only CASHIER requires a 4-digit PIN
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
    } catch (err: any) {
      setLoading(false)
      setFormError(err?.message || 'Unknown error')
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

  async function registerFingerprint(staffId: number) {
    setEnrollStatus(prev => ({ ...prev, [staffId]: { status: 'scanning', msg: 'Place finger on scanner…' } }))
    try {
      // Step 1 — capture from bridge
      let captureRes: Response
      try {
        const xml = `<?xml version="1.0"?><PidOptions ver="1.0"><Opts fCount="1" fType="0" iCount="0" pCount="0" format="0" pidVer="2.0" timeout="10000" otp="" wadh="" posh=""/></PidOptions>`
        captureRes = await fetch('http://127.0.0.1:11100/rd/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: xml,
        })
      } catch {
        throw new Error('Bridge not reachable — run: npm run fingerprint-bridge')
      }

      const template = await captureRes.text()

      // Parse bridge error if capture failed
      if (!captureRes.ok) {
        // Extract errInfo from PID XML if present
        const errMatch = template.match(/errInfo="([^"]+)"/)
        throw new Error(errMatch ? errMatch[1] : 'Scanner capture failed')
      }

      // Step 2 — save template
      const saveRes = await fetch('/api/staff/biometric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId, template }),
      })
      const result = await saveRes.json()
      if (!saveRes.ok) throw new Error(result.error ?? 'Save failed')

      setEnrollStatus(prev => ({
        ...prev,
        [staffId]: { status: 'ok', msg: `Scan ${result.samplesStored}/3 saved — ${result.samplesStored < 3 ? `add ${3 - result.samplesStored} more for best accuracy` : 'enrollment complete'}` },
      }))
      load()

      // Clear success message after 4 seconds
      setTimeout(() => setEnrollStatus(prev => { const n = { ...prev }; delete n[staffId]; return n }), 4000)
    } catch (e: any) {
      setEnrollStatus(prev => ({ ...prev, [staffId]: { status: 'err', msg: e.message ?? 'Unknown error' } }))
    }
  }

  async function clearFingerprint(staffId: number) {
    if (!confirm('Remove all fingerprint scans for this staff member?')) return
    await fetch('/api/staff/biometric', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffId }),
    })
    setEnrollStatus(prev => { const n = { ...prev }; delete n[staffId]; return n })
    load()
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
              <th className="text-center px-4 py-3 font-semibold text-gray-600">Biometrics</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {staff.map((s: any) => {
              const enroll = enrollStatus[s.id]
              let samples = 0
              try {
                const t = s.fingerprintTemplate?.trim()
                if (t) samples = t.startsWith('[') ? JSON.parse(t).length : 1
              } catch { /* ignore */ }

              return (
                <tr key={s.id} className={!s.active ? 'opacity-50' : ''}>
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3 text-gray-500">{s.email}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      s.role === 'ADMIN'    ? 'bg-indigo-100 text-indigo-700' :
                      s.role === 'CASHIER'  ? 'bg-blue-100 text-blue-700' :
                                              'bg-slate-100 text-slate-500'
                    }`}>
                      {s.role}
                    </span>
                  </td>

                  {/* Biometrics cell */}
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-center gap-1.5 min-w-[140px]">
                      {/* Enrollment status badge */}
                      {enroll ? (
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full w-full text-center ${
                          enroll.status === 'scanning' ? 'bg-blue-50 text-blue-600 animate-pulse' :
                          enroll.status === 'ok'       ? 'bg-green-50 text-green-700' :
                                                         'bg-red-50 text-red-600'
                        }`}>
                          {enroll.status === 'scanning' ? '⏳ ' : enroll.status === 'ok' ? '✓ ' : '✗ '}
                          {enroll.msg}
                        </span>
                      ) : samples > 0 ? (
                        <span className="text-emerald-600 font-bold text-xs flex items-center gap-1">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.092 2.027-.273 3M15 19l2-2m0 0l2-2m-2 2h-6"/>
                          </svg>
                          {samples}/3 scans enrolled
                        </span>
                      ) : (
                        <span className="text-gray-400 text-[11px]">No fingerprint</span>
                      )}

                      {/* Action buttons */}
                      <div className="flex gap-1">
                        {(samples < 3 && !enroll?.status) && (
                          <button
                            onClick={() => registerFingerprint(s.id)}
                            disabled={enroll?.status === 'scanning'}
                            className="text-[11px] px-2 py-0.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors"
                          >
                            {samples === 0 ? '+ Enroll' : '+Scan'}
                          </button>
                        )}
                        {samples > 0 && enroll?.status !== 'scanning' && (
                          <button
                            onClick={() => clearFingerprint(s.id)}
                            className="text-[11px] px-2 py-0.5 bg-red-50 text-red-500 rounded-md hover:bg-red-100 font-medium"
                          >
                            Clear
                          </button>
                        )}
                        {enroll?.status === 'err' && (
                          <button
                            onClick={() => registerFingerprint(s.id)}
                            className="text-[11px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 font-medium"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    </div>
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
                <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email (Optional)</label>
                <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})}
                  placeholder="Only for Admins/Cashiers"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {form.role === 'CASHIER' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">4-Digit PIN</label>
                    <input value={form.pin} onChange={e => setForm({...form, pin: e.target.value.slice(0,4)})} maxLength={4} inputMode="numeric"
                      placeholder="1234" pattern="[0-9]{4}"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-center font-mono tracking-widest focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                ) : (
                  <div />
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rank / Role</label>
                  <select value={form.role} onChange={e => setForm({...form, role: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="CASHIER">Cashier</option>
                    <option value="SUPPLIER">Supplier</option>
                    <option value="CLEANER">Cleaner</option>
                    {form.role && !['CASHIER','SUPPLIER','CLEANER'].includes(form.role) && (
                      <option value={form.role}>{form.role}</option>
                    )}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payroll Type</label>
                <div className="flex gap-2">
                  <select value={form.payrollType} onChange={e => setForm({...form, payrollType: e.target.value})}
                    className="w-1/2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="SALARY">Fixed Monthly Salary</option>
                    <option value="DAILY">Daily Wage</option>
                  </select>
                  {form.payrollType === 'SALARY' ? (
                    <input value={form.monthlySalary} onChange={e => setForm({...form, monthlySalary: e.target.value})} placeholder="Monthly ₹"
                      inputMode="decimal" className="w-1/2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  ) : (
                    <input value={form.dailyWage} onChange={e => setForm({...form, dailyWage: e.target.value})} placeholder="Per-day ₹"
                      inputMode="decimal" className="w-1/2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
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
    </div>
  )
}
