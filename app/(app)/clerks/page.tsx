"use client"

import { useEffect, useState } from "react"
import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"
import { Plus } from "lucide-react"

type Clerk = {
  id: number
  name: string
  isActive: boolean
  createdAt: string
}

export default function ClerksPage(): JSX.Element {
  const [clerks, setClerks] = useState<Clerk[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchClerks()
  }, [])

  async function fetchClerks() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/clerks")
      if (!res.ok) throw new Error("Failed to load clerks")
      const data = await res.json()
      if (Array.isArray(data)) setClerks(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error loading clerks")
    } finally {
      setLoading(false)
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/clerks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        throw new Error(error || "Failed to add clerk")
      }
      setNewName("")
      setShowAddForm(false)
      fetchClerks()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to add clerk")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageShell title="Clerk Management" subtitle="Manage clerks for POS attribution.">
      <div className="mb-6 flex justify-between items-center">
        <h2 className="text-lg font-bold text-slate-800">Active Clerks</h2>
        <Button onClick={() => setShowAddForm(!showAddForm)} variant="primary" className="flex items-center gap-2">
          <Plus size={16} /> Add Clerk
        </Button>
      </div>

      {showAddForm && (
        <form onSubmit={handleAdd} className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">New Clerk</h3>
          <div className="flex gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Clerk Name"
              className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
              autoFocus
              required
            />
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? "Saving..." : "Save Clerk"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setShowAddForm(false)}>
              Cancel
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
        <p className="text-sm text-slate-500">Loading clerks...</p>
      ) : clerks.length === 0 ? (
        <div className="rounded-xl border border-slate-200 border-dashed bg-slate-50 p-10 text-center">
          <p className="text-slate-500">No active clerks found. Add one to get started.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-6 py-4 font-semibold">ID</th>
                <th className="px-6 py-4 font-semibold">Name</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold">Created At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clerks.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/50">
                  <td className="px-6 py-4 text-slate-500 font-mono text-xs">{c.id}</td>
                  <td className="px-6 py-4 font-bold text-slate-900">{c.name}</td>
                  <td className="px-6 py-4">
                    <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                      Active
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-500">
                    {new Date(c.createdAt).toLocaleDateString()}
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
