"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"

import { Receipt, TrendingUp, IndianRupee, Activity, Search, Users } from "lucide-react"

import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"

type RecentBill = {
  id: number
  billNumber: string
  status: "COMMITTED" | "VOIDED" | string
  billedAt: string
  netCollectible: string
  grossTotal: string
  discountTotal: string
  operator?: { name: string }
  clerk?: { name: string } | null
  payments?: Array<{ mode: string; amount: string }>
  lines?: Array<{ id: number; itemNameSnapshot: string; quantity: number; lineTotal: string; sourceType: "LIQUOR" | "MISC" | string }>
}

function fmt(v: string | number): string {
  return "₹" + Number(v).toFixed(2)
}

export default function Page(): JSX.Element {
  const [bills, setBills] = useState<RecentBill[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(50)
  const [show, setShow] = useState<"ALL" | "COMMITTED" | "VOIDED">("ALL")
  const [q, setQ] = useState("")

  const fetchBills = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/pos/recent-bills?limit=${limit}`, { cache: "no-store" })
      if (!res.ok) throw new Error("Failed to load recent bills")
      const data = (await res.json()) as RecentBill[]
      setBills(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
      setBills([])
    } finally {
      setLoading(false)
    }
  }, [limit])

  useEffect(() => {
    void fetchBills()
  }, [fetchBills])

  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase()
    return bills.filter((b) => {
      if (show !== "ALL" && b.status !== show) return false
      if (!text) return true
      return (
        b.billNumber.toLowerCase().includes(text) ||
        (b.operator?.name ?? "").toLowerCase().includes(text) ||
        (b.clerk?.name ?? "").toLowerCase().includes(text)
      )
    })
  }, [bills, q, show])

  const totals = useMemo(() => {
    const committed = filtered.filter((b) => b.status === "COMMITTED")
    return {
      count: filtered.length,
      committedCount: committed.length,
      net: committed.reduce((sum, b) => sum + Number(b.netCollectible), 0),
      gross: committed.reduce((sum, b) => sum + Number(b.grossTotal), 0),
      discounts: committed.reduce((sum, b) => sum + Number(b.discountTotal), 0),
    }
  }, [filtered])

  return (
    <PageShell title="Sales Ledger">
      <div className="mb-4 flex flex-wrap items-center gap-4 border-b-2 border-slate-50 pb-8">
        <div className="flex-1 min-w-[280px] relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={18} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search bill number, operator or clerk..."
            className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 pl-12 pr-6 py-4 text-base font-black text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all"
          />
        </div>
        <div className="flex items-center gap-3 bg-white border-2 border-slate-100 p-2 rounded-2xl shadow-sm">
          <select
            value={show}
            onChange={(e) => setShow(e.target.value as typeof show)}
            className="appearance-none bg-transparent px-4 py-2 text-[11px] font-black uppercase tracking-widest text-slate-600 focus:outline-none cursor-pointer"
          >
            <option value="ALL">ALL STATUS</option>
            <option value="COMMITTED">COMMITTED</option>
            <option value="VOIDED">VOIDED</option>
          </select>
          <div className="h-6 w-px bg-slate-100" />
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="appearance-none bg-transparent px-4 py-2 text-[11px] font-black uppercase tracking-widest text-slate-600 focus:outline-none cursor-pointer"
          >
            <option value={20}>20 ROWS</option>
            <option value={50}>50 ROWS</option>
            <option value={100}>100 ROWS</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={fetchBills} disabled={loading} variant="secondary" className="rounded-2xl px-6 py-4 font-black uppercase tracking-widest text-[11px] shadow-lg">
            {loading ? "..." : "Refresh"}
          </Button>
          <a
            href="/pos"
            className="rounded-2xl bg-slate-900 px-6 py-4 text-[11px] font-black uppercase tracking-[0.2em] text-white hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/10 active:scale-95"
          >
            Open POS
          </a>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-6 md:grid-cols-4">
        <StatCard label="Total Dispatches" value={String(totals.count)} color="slate" icon={Receipt} />
        <StatCard label="Settled Bills" value={String(totals.committedCount)} color="indigo" icon={Activity} />
        <StatCard label="Gross Revenue" value={fmt(totals.gross)} color="emerald" icon={TrendingUp} />
        <StatCard label="Net Collectible" value={fmt(totals.net)} color="emerald" icon={IndianRupee} />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && filtered.length === 0 ? (
        <div className="py-3 text-center text-slate-400 font-black uppercase tracking-[0.2em] text-[11px]">Syncing Sales Stream…</div>
      ) : filtered.length === 0 ? (
        <div className="py-3 text-center text-slate-400 font-black uppercase tracking-[0.2em] text-[11px] border-4 border-slate-50 border-dashed rounded-xl">No records matching criteria</div>
      ) : (
        <div className="overflow-hidden rounded-xl border-2 border-slate-50 shadow-sm bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-[11px] font-black uppercase tracking-widest text-slate-500 border-b-2 border-slate-50">
              <tr>
                <th className="px-6 py-5">Sequential ID</th>
                <th className="px-6 py-5">Audit Timestamp</th>
                <th className="px-6 py-5">Clerk / Operator Attribution</th>
                <th className="px-6 py-5">Settlement Status</th>
                <th className="px-6 py-5 text-right">Net Magnitude</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-50">
              {filtered.map((b) => (
                <tr key={b.id} className="group hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-5 font-black text-slate-900 font-mono text-base">{b.billNumber}</td>
                  <td className="px-6 py-5 text-slate-400 font-bold">{new Date(b.billedAt).toLocaleString("en-IN", { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</td>
                  <td className="px-6 py-5 font-black text-slate-700 uppercase tracking-tight">
                    {b.clerk?.name ? (
                      <span className="flex items-center gap-2">
                        <Users size={14} className="text-slate-400" />
                        {b.clerk.name}
                        <span className="text-[10px] text-slate-300 font-bold">/</span>
                        <span className="text-slate-400 text-xs font-black">{b.operator?.name ?? "SYS"}</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Activity size={14} className="text-slate-400" />
                        MASTER COUNTER
                        <span className="text-[10px] text-slate-300 font-bold">/</span>
                        <span className="text-slate-400 text-xs font-black">{b.operator?.name ?? "SYS"}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-5">
                    <span
                      className={`inline-flex rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-widest shadow-sm ${
                        b.status === "VOIDED" ? "bg-rose-600 text-white" : "bg-emerald-600 text-white"
                      }`}
                    >
                      {b.status}
                    </span>
                  </td>
                  <td className="px-6 py-5 text-right font-black text-slate-900 text-lg tabular-nums">{fmt(b.netCollectible)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
    <div className={`rounded-xl border-2 p-4 shadow-sm transition-all hover:shadow-xl hover:-translate-y-1 ${tones}`}>
      <div className="flex justify-between items-start mb-4">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60">{label}</p>
        <div className="rounded-xl bg-white/50 p-2 shadow-inner">
          <Icon size={18} />
        </div>
      </div>
      <p className="text-lg font-black tracking-tight tabular-nums">{value}</p>
    </div>
  )
}
