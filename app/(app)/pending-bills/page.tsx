"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"

import { Activity, IndianRupee, Search, Clock, Users } from "lucide-react"

import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"

type TabBill = {
  id: number
  billNumber: string
  customerName: string | null
  customerPhone: string | null
  billedAt: string
  netCollectible: string
  status: "TAB_OPEN"
  operator?: { name: string } | null
  clerk?: { name: string } | null
  lines: Array<{
    id: number
    itemNameSnapshot: string
    quantity: number
    unitPrice: string
    lineTotal: string
  }>
}

function fmt(v: string | number): string {
  return "₹" + Number(v).toFixed(2)
}

export default function Page(): JSX.Element {
  const [tabs, setTabs] = useState<TabBill[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState("")

  const fetchTabs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/pos/open-tabs", { cache: "no-store" })
      if (!res.ok) throw new Error("Failed to load open tabs")
      const data = (await res.json()) as TabBill[]
      setTabs(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchTabs()
  }, [fetchTabs])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return tabs
    return tabs.filter((b) => {
      return (
        b.billNumber.toLowerCase().includes(t) ||
        (b.customerName ?? "").toLowerCase().includes(t) ||
        (b.customerPhone ?? "").toLowerCase().includes(t)
      )
    })
  }, [q, tabs])

  const totalPending = useMemo(() => {
    return filtered.reduce((sum, b) => sum + Number(b.netCollectible), 0)
  }, [filtered])

  return (
    <PageShell title="Account Tabs" subtitle="Review and reconcile active credit dispatches and unsettled customer sessions.">
      <div className="mb-10 flex flex-wrap items-center gap-4 border-b-2 border-slate-50 pb-8">
        <div className="flex-1 min-w-[280px] relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors" size={18} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search bill number or customer identity..."
            className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 pl-12 pr-6 py-4 text-base font-black text-slate-800 placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:outline-none transition-all"
          />
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={fetchTabs} disabled={loading} variant="secondary" className="rounded-2xl px-6 py-4 font-black uppercase tracking-widest text-[11px] shadow-lg">
            {loading ? "..." : "Refresh"}
          </Button>
          <a
            href="/pos"
            className="rounded-2xl bg-emerald-600 px-6 py-4 text-[11px] font-black uppercase tracking-[0.2em] text-white hover:bg-emerald-500 transition-all shadow-xl shadow-emerald-600/10 active:scale-95 flex items-center gap-2"
          >
            <Activity size={14} /> Open POS Registry
          </a>
        </div>
      </div>

      <div className="mb-10 grid grid-cols-1 gap-6 md:grid-cols-3">
        <StatCard label="Active Sessions" value={String(filtered.length)} color="indigo" icon={Activity} />
        <StatCard label="Outstanding Exposure" value={fmt(totalPending)} color="emerald" icon={IndianRupee} />
        <StatCard label="Registry Action" value="SETTLE IN POS" color="slate" icon={Search} />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && filtered.length === 0 ? (
        <div className="py-20 text-center text-slate-400 font-black uppercase tracking-[0.2em] text-[11px]">Syncing Open Registries…</div>
      ) : filtered.length === 0 ? (
        <div className="py-24 text-center border-4 border-slate-50 border-dashed rounded-[3rem]">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">All sessions currently reconciled</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          {filtered.map((b) => (
            <div key={b.id} className="rounded-[2.5rem] border-2 border-slate-50 bg-white p-8 shadow-sm hover:shadow-xl transition-all group">
              <div className="flex flex-wrap items-start justify-between gap-6 mb-8">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="rounded-xl bg-slate-900 px-3 py-1.5 text-[11px] font-black text-white font-mono tracking-wider">{b.billNumber}</span>
                    <span className="rounded-xl bg-amber-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-amber-600 border border-amber-100">Pending Settlement</span>
                  </div>
                  <h3 className="text-2xl font-black text-slate-900 tracking-tight">
                    {b.customerName ?? "Master Walk-in"}
                  </h3>
                  {b.customerPhone && <p className="text-sm font-black text-slate-400 mt-1 uppercase tracking-widest">{b.customerPhone}</p>}
                  
                  <div className="flex items-center gap-4 mt-6">
                    <div className="flex items-center gap-2 text-slate-400">
                      <Clock size={14} />
                      <p className="text-[10px] font-black uppercase tracking-widest">{new Date(b.billedAt).toLocaleString("en-IN", { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</p>
                    </div>
                    <div className="h-4 w-px bg-slate-100" />
                    <div className="flex items-center gap-2 text-slate-400">
                      <Users size={14} />
                      <p className="text-[10px] font-black uppercase tracking-widest">{b.clerk?.name ?? "Counter"}</p>
                    </div>
                  </div>
                </div>
                <div className="bg-emerald-50 rounded-[2rem] p-8 border-2 border-emerald-100/50 flex flex-col items-end">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600/60 mb-2">Aggregate Due</p>
                  <p className="text-4xl font-black text-emerald-700 tracking-tighter tabular-nums">{fmt(b.netCollectible)}</p>
                </div>
              </div>

              <div className="overflow-hidden rounded-3xl border-2 border-slate-50">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b-2 border-slate-50">
                    <tr>
                      <th className="px-5 py-4 text-left">Article Snapshot</th>
                      <th className="px-5 py-4 text-center">Unit Volume</th>
                      <th className="px-5 py-4 text-right">Magnitude</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y-2 divide-slate-50">
                    {b.lines.map((l) => (
                      <tr key={l.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-4 font-black text-slate-800 uppercase tracking-tight text-xs">{l.itemNameSnapshot}</td>
                        <td className="px-5 py-4 text-center font-black text-slate-400 text-xs">{l.quantity}x</td>
                        <td className="px-5 py-4 text-right font-black text-slate-900 tabular-nums">{fmt(l.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-8 flex justify-end">
                <a href={`/pos?resume=${b.id}`} className="rounded-2xl bg-slate-900 px-8 py-4 text-[11px] font-black uppercase tracking-[0.2em] text-white hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/10 active:scale-95">
                  Resume Registry Session
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  )
}

function StatCard({ label, value, color, icon: Icon }: { label: string; value: string; color: "emerald" | "indigo" | "rose" | "slate"; icon: React.ElementType }): JSX.Element {
  const tones = {
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    indigo: "border-indigo-100 bg-indigo-50 text-indigo-700",
    rose: "border-rose-100 bg-rose-50 text-rose-700",
    slate: "border-slate-100 bg-slate-50 text-slate-600",
  }[color]

  return (
    <div className={`rounded-3xl border-2 p-8 shadow-sm transition-all hover:shadow-xl hover:-translate-y-1 ${tones}`}>
      <div className="flex justify-between items-start mb-4">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60">{label}</p>
        <div className="rounded-xl bg-white/50 p-2 shadow-inner">
          <Icon size={18} />
        </div>
      </div>
      <p className="text-3xl font-black tracking-tight tabular-nums">{value}</p>
    </div>
  )
}
