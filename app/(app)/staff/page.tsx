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
    <PageShell title="Staff Directory" subtitle="Manage employees, roles, payroll, and schedules.">
      <div className="mb-6 flex justify-between items-center">
        <h2 className="text-lg font-bold text-slate-800">Active Staff</h2>
        <Button onClick={() => setShowAddForm(!showAddForm)} variant="primary" className="flex items-center gap-2">
          <Plus size={16} /> Add Staff
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
        <p className="text-sm text-slate-500">Loading staff...</p>
      ) : staffList.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center">
          <p className="text-slate-500">No active staff members.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-4 font-semibold">Staff</th>
                <th className="px-5 py-4 font-semibold">Payroll</th>
                <th className="px-5 py-4 font-semibold">Shift</th>
                <th className="px-5 py-4 font-semibold text-center">Face</th>
                <th className="px-5 py-4 font-semibold text-right">Bills</th>
                <th className="px-5 py-4 font-semibold text-right">Revenue</th>
                <th className="px-5 py-4 font-semibold text-right">Days</th>
                <th className="px-5 py-4 font-semibold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staffList.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-5 py-4">
                    <p className="font-bold text-slate-900">{s.name}</p>
                    <p className="text-xs text-slate-400 uppercase tracking-tight">{s.role} · {s.pin ? `PIN ${s.pin}` : "No PIN"}</p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="font-semibold text-slate-800 text-xs uppercase tracking-wide">{s.payrollType}</p>
                    <p className="text-xs text-emerald-700 font-bold">
                      {s.payrollType === "SALARY" && s.monthlySalary != null && `₹${s.monthlySalary.toLocaleString()}/mo`}
                      {s.payrollType === "DAILY" && s.dailyWage != null && `₹${s.dailyWage}/day`}
                    </p>
                  </td>
                  <td className="px-5 py-4">
                    {s.shift ? (
                      <div>
                        <p className="text-xs font-bold text-slate-700 flex items-center gap-1">
                          <Clock size={11} /> {s.shift.startTime} – {s.shift.endTime}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {s.shift.activeDays.map((d) => DAYS[d]).join(" ")}
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-center">
                    {s.faceEnrolled ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        ✓ {s.faceSampleCount}
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600">None</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right font-bold text-slate-700">{s.billsHandled}</td>
                  <td className="px-5 py-4 text-right font-black text-emerald-700">₹{s.ownerNetRevenue.toLocaleString()}</td>
                  <td className="px-5 py-4 text-right font-bold text-slate-600">{s.attendanceDays}d</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-center gap-3">
                      <button onClick={() => openEdit(s)} className="text-indigo-600 hover:text-indigo-900 text-xs font-bold uppercase tracking-wider">Edit</button>
                      <Link href={`/staff/${s.id}/enroll`} className="flex items-center gap-1 text-purple-600 hover:text-purple-900 text-xs font-bold uppercase tracking-wider">
                        <Camera size={11} /> Face
                      </Link>
                      <button onClick={() => handleRemove(s.id)} className="text-red-500 hover:text-red-800 text-xs font-bold uppercase tracking-wider">Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
    ? "w-full rounded-2xl bg-white p-8 shadow-2xl"
    : "mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"

  return (
    <form onSubmit={onSubmit} className={cls}>
      <h3 className="text-base font-black uppercase tracking-widest text-slate-700 mb-6 border-b pb-4">{title}</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div>
          <label className="field-label">Name</label>
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Full name" className="field-input" autoFocus />
        </div>
        <div>
          <label className="field-label">Role</label>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="field-input">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">PIN (4 digits)</label>
          <input value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })}
            placeholder="Optional" pattern="^\d{4}$" title="4-digit PIN" className="field-input" />
        </div>
        <div>
          <label className="field-label">Late Grace (minutes)</label>
          <input type="number" min={0} max={120} value={form.lateGraceMinutes}
            onChange={(e) => setForm({ ...form, lateGraceMinutes: e.target.value })} className="field-input" />
        </div>
      </div>

      {/* Payroll */}
      <div className="border border-slate-100 rounded-xl p-4 mb-5 bg-slate-50/50">
        <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-1.5"><Banknote size={12} /> Payroll</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="field-label">Type</label>
            <select value={form.payrollType} onChange={(e) => setForm({ ...form, payrollType: e.target.value })} className="field-input">
              <option value="SALARY">Monthly Salary</option>
              <option value="DAILY">Daily Wage</option>
            </select>
          </div>
          {form.payrollType === "SALARY" && (
            <div>
              <label className="field-label">Monthly Salary (₹)</label>
              <input type="number" min={0} step="0.01" value={form.monthlySalary}
                onChange={(e) => setForm({ ...form, monthlySalary: e.target.value })}
                placeholder="e.g. 15000" className="field-input" />
            </div>
          )}
          {form.payrollType === "DAILY" && (
            <div>
              <label className="field-label">Daily Wage (₹)</label>
              <input type="number" min={0} step="0.01" value={form.dailyWage}
                onChange={(e) => setForm({ ...form, dailyWage: e.target.value })}
                placeholder="e.g. 500" className="field-input" />
            </div>
          )}
        </div>
      </div>

      {/* Shift */}
      <div className="border border-slate-100 rounded-xl p-4 mb-6 bg-slate-50/50">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5"><Clock size={12} /> Work Shift</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.shiftEnabled} onChange={(e) => setForm({ ...form, shiftEnabled: e.target.checked })} className="rounded" />
            <span className="text-xs font-semibold text-slate-600">Enable shift tracking</span>
          </label>
        </div>
        {form.shiftEnabled && (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <label className="field-label">Start Time</label>
                <input type="time" value={form.shiftStart} onChange={(e) => setForm({ ...form, shiftStart: e.target.value })} className="field-input" />
              </div>
              <div>
                <label className="field-label">End Time</label>
                <input type="time" value={form.shiftEnd} onChange={(e) => setForm({ ...form, shiftEnd: e.target.value })} className="field-input" />
              </div>
            </div>
            <label className="field-label mb-2">Active Days</label>
            <div className="flex gap-2 flex-wrap">
              {DAYS.map((day, i) => (
                <button key={day} type="button"
                  onClick={() => setForm({ ...form, activeDays: toggleDay(form.activeDays, i) })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                    form.activeDays.includes(i)
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-3 justify-end">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? "Saving..." : submitLabel}
        </Button>
      </div>
    </form>
  )
}
