"use client"

import { useEffect, useState } from "react"
import { Plus } from "lucide-react"

import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"

type Clerk = {
  id: number
  name: string
  isActive: boolean
  createdAt: string
  metrics: {
    billsHandled: number
    totalSales: number
  }
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
    <PageShell title="Clerk Management" subtitle="Configure sales attribution for POS operators and monitor individual throughput.">
      <div className="mb-10 flex justify-between items-center border-b-2 border-slate-50 pb-8">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Active Roster</h2>
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 mt-1">Operational Sales Attribution</p>
        </div>
        <Button onClick={() => setShowAddForm(!showAddForm)} variant="primary" className="flex items-center gap-3 px-8 py-4 rounded-2xl shadow-xl shadow-slate-900/10 font-black uppercase tracking-widest text-[11px] active:scale-95 transition-all">
          <Plus size={18} /> Register Clerk
        </Button>
      </div>

      {showAddForm && (
        <form onSubmit={handleAdd} className="mb-10 rounded-[2.5rem] border-2 border-slate-100 bg-white p-8 shadow-sm animate-in slide-in-from-top-4 duration-500">
          <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-6">Create New Personnel Entry</h3>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[280px]">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2 px-1">Full Legal Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Enter clerk identity..."
                className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-5 py-4 text-base font-black text-slate-800 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all"
                autoFocus
                required
              />
            </div>
            <div className="flex gap-3">
              <Button type="submit" variant="primary" disabled={submitting} className="rounded-2xl px-10 py-4 font-black uppercase tracking-widest text-[11px] shadow-xl">
                {submitting ? "Processing…" : "Register"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowAddForm(false)} className="rounded-2xl px-6 py-4 font-black uppercase tracking-widest text-[11px] text-slate-400">
                Cancel
              </Button>
            </div>
          </div>
        </form>
      )}

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-slate-400 font-black uppercase tracking-[0.2em] text-[11px]">Syncing Clerk Data…</div>
      ) : clerks.length === 0 ? (
        <div className="py-24 text-center border-4 border-slate-50 border-dashed rounded-[3rem]">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">No active clerks configured</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border-2 border-slate-50 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 border-b-2 border-slate-50">
              <tr>
                <th className="px-6 py-5">Personnel ID</th>
                <th className="px-6 py-5">Identity</th>
                <th className="px-6 py-5 text-right">Throughput (Bills)</th>
                <th className="px-6 py-5 text-right">Cumulative Sales</th>
                <th className="px-6 py-5 text-center">Status</th>
                <th className="px-6 py-5 text-right">Registration Date</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-50">
              {clerks.map((c) => (
                <tr key={c.id} className="group hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-5 text-slate-400 font-black font-mono text-xs">#{c.id}</td>
                  <td className="px-6 py-5 font-black text-slate-900 text-base">{c.name}</td>
                  <td className="px-6 py-5 text-right text-slate-700 font-black tabular-nums">{c.metrics.billsHandled}</td>
                  <td className="px-6 py-5 text-right text-emerald-600 font-black text-base tabular-nums">₹{c.metrics.totalSales.toLocaleString()}</td>
                  <td className="px-6 py-5 text-center">
                    <span className="inline-flex rounded-xl bg-emerald-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white shadow-sm shadow-emerald-600/20">
                      Active
                    </span>
                  </td>
                  <td className="px-6 py-5 text-right text-slate-400 font-bold uppercase tracking-widest text-[10px]">
                    {new Date(c.createdAt).toLocaleDateString("en-IN", { day: '2-digit', month: 'short', year: 'numeric' })}
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
