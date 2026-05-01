"use client"

import { useEffect, useState } from "react"
import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"
import { Plus } from "lucide-react"

type Staff = {
  id: number
  name: string
  role: string
  payrollType: string
  pin?: string | null
}

export default function StaffPage(): JSX.Element {
  const [staffList, setStaffList] = useState<Staff[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState("")
  const [newRole, setNewRole] = useState("OTHER")
  const [newPayroll, setNewPayroll] = useState("SALARY")
  const [newPin, setNewPin] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchStaff()
  }, [])

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

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          role: newRole,
          payrollType: newPayroll,
          pin: newPin.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        throw new Error(error || "Failed to add staff")
      }
      setNewName("")
      setNewRole("OTHER")
      setNewPayroll("SALARY")
      setNewPin("")
      setShowAddForm(false)
      fetchStaff()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to add staff")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageShell title="Staff Directory" subtitle="Manage employees, roles, and access.">
      <div className="mb-6 flex justify-between items-center">
        <h2 className="text-lg font-bold text-slate-800">Active Staff</h2>
        <Button onClick={() => setShowAddForm(!showAddForm)} variant="primary" className="flex items-center gap-2">
          <Plus size={16} /> Add Staff
        </Button>
      </div>

      {showAddForm && (
        <form onSubmit={handleAdd} className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">New Staff Member</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Full Name"
                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
                autoFocus
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
              >
                <option value="ADMIN">Admin</option>
                <option value="CASHIER">Cashier</option>
                <option value="SUPPLIER">Supplier</option>
                <option value="HELPER">Helper</option>
                <option value="LOADER">Loader</option>
                <option value="COLLECTOR">Collector</option>
                <option value="CLEANER">Cleaner</option>
                <option value="WATCHMAN">Watchman</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Payroll</label>
              <select
                value={newPayroll}
                onChange={(e) => setNewPayroll(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
              >
                <option value="SALARY">Monthly Salary</option>
                <option value="DAILY">Daily Wage</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">PIN (Optional)</label>
              <input
                type="text"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                placeholder="4-digit PIN"
                pattern="^\d{4}$"
                title="Must be a 4-digit number"
                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <Button type="button" variant="secondary" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? "Saving..." : "Save Staff"}
            </Button>
          </div>
        </form>
      )}

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading staff...</p>
      ) : staffList.length === 0 ? (
        <div className="rounded-xl border border-slate-200 border-dashed bg-slate-50 p-10 text-center">
          <p className="text-slate-500">No active staff members found.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-6 py-4 font-semibold">ID</th>
                <th className="px-6 py-4 font-semibold">Name</th>
                <th className="px-6 py-4 font-semibold">Role</th>
                <th className="px-6 py-4 font-semibold">Payroll</th>
                <th className="px-6 py-4 font-semibold">Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staffList.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/50">
                  <td className="px-6 py-4 text-slate-500 font-mono text-xs">{s.id}</td>
                  <td className="px-6 py-4 font-bold text-slate-900">{s.name}</td>
                  <td className="px-6 py-4">
                    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-800">
                      {s.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-600">{s.payrollType}</td>
                  <td className="px-6 py-4">
                    {s.pin ? (
                      <span className="inline-flex rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-800">
                        PIN Set
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs italic">No Login</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  )
}
