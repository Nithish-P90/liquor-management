"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"
import { Plus, Camera, Clock, Banknote } from "lucide-react"

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const ROLES = ["ADMIN", "CASHIER", "SUPPLIER", "HELPER", "LOADER", "COLLECTOR", "CLEANER", "WATCHMAN", "OTHER"]

type ShiftTemplate = {
  id?: number
  startTime: string
  endTime: string
  activeDays: number[]
}

type StaffRow = {
  id: number
  name: string
  role: string
  payrollType: string
  pin: string | null
  monthlySalary: number | null
  dailyWage: number | null
  lateGraceMinutes: number
  faceEnrolled: boolean
  faceSampleCount: number
  shift: ShiftTemplate | null
  billsHandled: number
  totalRevenue: number
  ownerNetRevenue: number
  attendanceDays: number
}

type EditForm = {
  name: string
  role: string
  payrollType: string
  pin: string
  monthlySalary: string
  dailyWage: string
  lateGraceMinutes: string
  shiftEnabled: boolean
  shiftStart: string
  shiftEnd: string
  activeDays: number[]
}

function defaultEdit(s: StaffRow): EditForm {
  return {
    name: s.name,
    role: s.role,
    payrollType: s.payrollType,
    pin: s.pin ?? "",
    monthlySalary: s.monthlySalary != null ? String(s.monthlySalary) : "",
    dailyWage: s.dailyWage != null ? String(s.dailyWage) : "",
    lateGraceMinutes: String(s.lateGraceMinutes),
    shiftEnabled: !!s.shift,
    shiftStart: s.shift?.startTime ?? "09:00",
    shiftEnd: s.shift?.endTime ?? "18:00",
    activeDays: s.shift?.activeDays ?? [0, 1, 2, 3, 4, 5],
  }
}

function toggleDay(days: number[], d: number): number[] {
  return days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort()
}

export default function StaffPage(): JSX.Element {
  const [staffList, setStaffList] = useState<StaffRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

  const [addForm, setAddForm] = useState<EditForm>({
    name: "", role: "OTHER", payrollType: "SALARY", pin: "",
    monthlySalary: "", dailyWage: "", lateGraceMinutes: "15",
    shiftEnabled: false, shiftStart: "09:00", shiftEnd: "18:00", activeDays: [0, 1, 2, 3, 4, 5],
  })
  const [editForm, setEditForm] = useState<EditForm | null>(null)

  useEffect(() => { fetchStaff() }, [])

  async function fetchStaff() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/staff")
      if (!res.ok) throw new Error("Failed to load staff")
      const data = await res.json()
      if (Array.isArray(data)) setStaffList(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error loading staff")
    } finally {
      setLoading(false)
    }
  }

  function buildPayload(f: EditForm) {
    return {
      name: f.name.trim(),
      role: f.role,
      payrollType: f.payrollType,
      pin: f.pin.trim() || null,
      monthlySalary: f.payrollType === "SALARY" && f.monthlySalary ? parseFloat(f.monthlySalary) : null,
      dailyWage: f.payrollType === "DAILY" && f.dailyWage ? parseFloat(f.dailyWage) : null,
      lateGraceMinutes: parseInt(f.lateGraceMinutes, 10) || 15,
      shift: f.shiftEnabled
        ? { startTime: f.shiftStart, endTime: f.shiftEnd, activeDays: f.activeDays }
        : null,
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(addForm)),
      })
      if (!res.ok) {
        const { error } = await res.json()
        throw new Error(error || "Failed to add staff")
      }
      setShowAddForm(false)
      setAddForm({ name: "", role: "OTHER", payrollType: "SALARY", pin: "", monthlySalary: "", dailyWage: "", lateGraceMinutes: "15", shiftEnabled: false, shiftStart: "09:00", shiftEnd: "18:00", activeDays: [0, 1, 2, 3, 4, 5] })
      fetchStaff()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingId || !editForm) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/staff/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(editForm)),
      })
      if (!res.ok) {
        const { error } = await res.json()
        throw new Error(error || "Failed to update staff")
      }
      setEditingId(null)
      setEditForm(null)
      fetchStaff()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRemove(id: number) {
    if (!confirm("Deactivate this staff member?")) return
    try {
      const res = await fetch(`/api/staff/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to remove")
      fetchStaff()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to remove staff")
    }
  }

  function openEdit(s: StaffRow) {
    setEditingId(s.id)
    setEditForm(defaultEdit(s))
  }

  return (
    <PageShell title="Staff Directory" subtitle="Manage employee profiles, access credentials, and payroll configurations.">
      <div className="mb-10 flex justify-between items-center border-b-2 border-slate-50 pb-8">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Active Roster</h2>
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 mt-1">Enterprise Access Control</p>
        </div>
        <Button onClick={() => setShowAddForm(!showAddForm)} variant="primary" className="flex items-center gap-3 px-6 py-3.5 rounded-2xl shadow-xl shadow-slate-900/10 font-black uppercase tracking-widest text-[11px] active:scale-95 transition-all">
          <Plus size={18} /> Register Staff
        </Button>
      </div>

      {showAddForm && (
        <StaffForm
          title="New Staff Member"
          form={addForm}
          setForm={setAddForm}
          onSubmit={handleAdd}
          onCancel={() => setShowAddForm(false)}
          submitting={submitting}
          submitLabel="Add Staff"
        />
      )}

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="py-20 text-center text-slate-400 font-black uppercase tracking-[0.2em] text-[11px]">Syncing Staff Data…</div>
      ) : staffList.length === 0 ? (
        <div className="rounded-3xl border-4 border-slate-50 border-dashed bg-slate-50/30 p-20 text-center">
          <p className="text-slate-400 font-black uppercase tracking-[0.2em] text-[11px]">No active staff entries found</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border-2 border-slate-50 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 border-b-2 border-slate-50">
              <tr>
                <th className="px-6 py-5">Personnel</th>
                <th className="px-6 py-5">Payroll Model</th>
                <th className="px-6 py-5">Shift Schedule</th>
                <th className="px-6 py-5 text-center">Biometrics</th>
                <th className="px-6 py-5 text-right">Bills</th>
                <th className="px-6 py-5 text-right">Revenue</th>
                <th className="px-6 py-5 text-right">Days</th>
                <th className="px-6 py-5 text-center">Management</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-50">
              {staffList.map((s) => (
                <tr key={s.id} className="group hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-5">
                    <p className="font-black text-slate-900 text-base tracking-tight">{s.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[9px] font-black text-white">{s.role}</span>
                      <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{s.pin ? `PIN ${s.pin}` : "NO ACCESS PIN"}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{s.payrollType}</p>
                    <p className="text-sm text-emerald-700 font-black">
                      {s.payrollType === "SALARY" && s.monthlySalary != null && `₹${s.monthlySalary.toLocaleString()}/mo`}
                      {s.payrollType === "DAILY" && s.dailyWage != null && `₹${s.dailyWage}/day`}
                    </p>
                  </td>
                  <td className="px-6 py-5">
                    {s.shift ? (
                      <div className="space-y-1">
                        <p className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                          <Clock size={12} className="text-slate-400" /> {s.shift.startTime} – {s.shift.endTime}
                        </p>
                        <div className="flex gap-0.5">
                          {DAYS.map((d, i) => (
                            <span key={d} className={`text-[8px] font-black px-1 rounded ${s.shift?.activeDays.includes(i) ? "bg-indigo-100 text-indigo-700" : "text-slate-300"}`}>{d[0]}</span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Fixed Schedule</span>
                    )}
                  </td>
                  <td className="px-6 py-5 text-center">
                    {s.faceEnrolled ? (
                      <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white shadow-sm shadow-emerald-600/20">
                        <Camera size={10} /> ENROLLED ({s.faceSampleCount})
                      </span>
                    ) : (
                      <span className="inline-flex rounded-xl bg-slate-100 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">PENDING</span>
                    )}
                  </td>
                  <td className="px-6 py-5 text-right font-black text-slate-600 tabular-nums">{s.billsHandled}</td>
                  <td className="px-6 py-5 text-right font-black text-emerald-600 text-base tabular-nums">₹{s.ownerNetRevenue.toLocaleString()}</td>
                  <td className="px-6 py-5 text-right font-black text-slate-500 tabular-nums">{s.attendanceDays}d</td>
                  <td className="px-6 py-5">
                    <div className="flex items-center justify-center gap-4">
                      <button onClick={() => openEdit(s)} className="text-indigo-600 hover:text-indigo-900 text-[10px] font-black uppercase tracking-widest transition-colors">Configure</button>
                      <Link href={`/staff/${s.id}/enroll`} className="flex items-center gap-1.5 text-slate-900 hover:text-indigo-600 text-[10px] font-black uppercase tracking-widest transition-colors">
                        Enroll
                      </Link>
                      <button onClick={() => handleRemove(s.id)} className="text-rose-400 hover:text-rose-600 text-[10px] font-black uppercase tracking-widest transition-colors">Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {editingId !== null && editForm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-2xl my-4">
            <StaffForm
              title={`Edit: ${staffList.find((s) => s.id === editingId)?.name ?? ""}`}
              form={editForm}
              setForm={setEditForm}
              onSubmit={handleEdit}
              onCancel={() => { setEditingId(null); setEditForm(null) }}
              submitting={submitting}
              submitLabel="Update Staff"
              isModal
            />
          </div>
        </div>
      )}
    </PageShell>
  )
}

function StaffForm({
  title, form, setForm, onSubmit, onCancel, submitting, submitLabel, isModal = false,
}: {
  title: string
  form: EditForm
  setForm: (f: EditForm) => void
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
  submitting: boolean
  submitLabel: string
  isModal?: boolean
}) {
  const cls = isModal
    ? "w-full rounded-3xl bg-white p-10 shadow-2xl scale-100 animate-in zoom-in-95 duration-300"
    : "mb-10 rounded-3xl border-2 border-slate-100 bg-white p-8 shadow-sm animate-in slide-in-from-top-4 duration-500"

  return (
    <form onSubmit={onSubmit} className={cls}>
      <h3 className="text-xl font-black uppercase tracking-tight text-slate-900 mb-8 flex items-center justify-between">
        {title}
        {isModal && <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-900"><Plus className="rotate-45" size={24}/></button>}
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <Field label="Personnel Name">
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Full identity" className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-5 py-4 text-base font-black text-slate-800 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all" autoFocus />
        </Field>
        <Field label="Assigned Role">
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full appearance-none rounded-2xl border-2 border-slate-100 bg-slate-50 px-5 py-4 text-base font-black text-slate-800 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="System Access PIN">
          <input value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })}
            placeholder="4 Digit Code" pattern="^\d{4}$" title="4-digit PIN" className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-5 py-4 text-base font-black font-mono text-slate-800 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all" />
        </Field>
        <Field label="Attendance Grace (Min)">
          <input type="number" min={0} max={120} value={form.lateGraceMinutes}
            onChange={(e) => setForm({ ...form, lateGraceMinutes: e.target.value })} className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-5 py-4 text-base font-black text-slate-800 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all" />
        </Field>
      </div>

      {/* Payroll */}
      <div className="border-2 border-slate-50 rounded-3xl p-8 mb-8 bg-slate-50/50">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-6 flex items-center gap-2"><Banknote size={14} /> Payroll Configuration</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Field label="Remuneration Model">
            <select value={form.payrollType} onChange={(e) => setForm({ ...form, payrollType: e.target.value })} className="w-full appearance-none rounded-2xl border-2 border-slate-100 bg-white px-5 py-4 text-base font-black text-slate-800 focus:border-indigo-400 focus:outline-none transition-all">
              <option value="SALARY">MONTHLY SALARY</option>
              <option value="DAILY">DAILY WAGE</option>
            </select>
          </Field>
          {form.payrollType === "SALARY" && (
            <Field label="Monthly Base (₹)">
              <input type="number" min={0} step="0.01" value={form.monthlySalary}
                onChange={(e) => setForm({ ...form, monthlySalary: e.target.value })}
                placeholder="0.00" className="w-full rounded-2xl border-2 border-slate-100 bg-white px-5 py-4 text-xl font-black text-emerald-600 focus:border-emerald-400 focus:outline-none transition-all" />
            </Field>
          )}
          {form.payrollType === "DAILY" && (
            <Field label="Daily Payout (₹)">
              <input type="number" min={0} step="0.01" value={form.dailyWage}
                onChange={(e) => setForm({ ...form, dailyWage: e.target.value })}
                placeholder="0.00" className="w-full rounded-2xl border-2 border-slate-100 bg-white px-5 py-4 text-xl font-black text-emerald-600 focus:border-emerald-400 focus:outline-none transition-all" />
            </Field>
          )}
        </div>
      </div>

      {/* Shift */}
      <div className="border-2 border-slate-50 rounded-3xl p-8 mb-10 bg-slate-50/50">
        <div className="flex items-center justify-between mb-6">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2"><Clock size={14} /> Operational Shift</p>
          <label className="flex items-center gap-3 cursor-pointer group">
            <input type="checkbox" checked={form.shiftEnabled} onChange={(e) => setForm({ ...form, shiftEnabled: e.target.checked })} className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
            <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 group-hover:text-slate-900 transition-colors">Track Shift Timing</span>
          </label>
        </div>
        {form.shiftEnabled && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <Field label="Shift Start">
                <input type="time" value={form.shiftStart} onChange={(e) => setForm({ ...form, shiftStart: e.target.value })} className="w-full rounded-2xl border-2 border-slate-100 bg-white px-5 py-4 text-base font-black text-slate-800 focus:border-indigo-400 focus:outline-none transition-all" />
              </Field>
              <Field label="Shift End">
                <input type="time" value={form.shiftEnd} onChange={(e) => setForm({ ...form, shiftEnd: e.target.value })} className="w-full rounded-2xl border-2 border-slate-100 bg-white px-5 py-4 text-base font-black text-slate-800 focus:border-indigo-400 focus:outline-none transition-all" />
              </Field>
            </div>
            <Field label="Roster Availability">
              <div className="flex gap-2 flex-wrap">
                {DAYS.map((day, i) => (
                  <button key={day} type="button"
                    onClick={() => setForm({ ...form, activeDays: toggleDay(form.activeDays, i) })}
                    className={`rounded-xl px-5 py-3 text-[10px] font-black uppercase tracking-widest transition-all ${
                      form.activeDays.includes(i)
                        ? "bg-slate-900 text-white shadow-lg"
                        : "bg-white text-slate-400 border-2 border-slate-100 hover:border-indigo-200"
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        )}
      </div>

      <div className="flex gap-4 justify-end">
        <Button type="button" variant="ghost" onClick={onCancel} className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-rose-600">Cancel</Button>
        <Button type="submit" variant="primary" disabled={submitting} className="px-10 py-4 text-sm font-black uppercase tracking-[0.2em] shadow-xl active:scale-95 transition-all">
          {submitting ? "Processing…" : submitLabel}
        </Button>
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 block px-1">{label}</label>
      {children}
    </div>
  )
}
  )
}
