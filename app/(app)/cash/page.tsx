"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"

import { Calendar, IndianRupee, Lock, Unlock, Activity } from "lucide-react"

import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"

type GallaEvent = {
  id: number
  occurredAt: string
  kind: string
  amount: string
  notes: string | null
  createdById: number | null
}

type GallaDayResponse =
  | { date: string; balance: string; events: GallaEvent[]; isClosed: boolean }
  | { id: number; businessDate: string; isClosed: boolean; closedAt: string | null; events: GallaEvent[]; balance: string }

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmt(v: string | number): string {
  return "₹" + Number(v).toFixed(2)
}

export default function Page(): JSX.Element {
  const [date, setDate] = useState(today())
  const [data, setData] = useState<GallaDayResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchDay = useCallback(async (d: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/galla?date=${encodeURIComponent(d)}`, { cache: "no-store" })
      if (!res.ok) throw new Error("Failed to load cash register")
      setData((await res.json()) as GallaDayResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchDay(date)
  }, [date, fetchDay])

  const events = useMemo(() => {
    if (!data) return []
    return "events" in data ? data.events : []
  }, [data])

  const balance = useMemo(() => {
    if (!data) return "0.00"
    return "balance" in data ? data.balance : "0.00"
  }, [data])

  const isClosed = useMemo(() => {
    if (!data) return false
    return "isClosed" in data ? data.isClosed : false
  }, [data])

  return (
    <PageShell title="Cash Register" subtitle="Review real-time galla balance and chronological audit trail of cash movements.">
      <div className="mb-4 flex flex-wrap items-center gap-4 border-b-2 border-slate-50 pb-8">
        <div className="flex items-center gap-4 bg-white border-2 border-slate-100 p-2 rounded-2xl shadow-sm">
          <div className="flex items-center gap-3 px-3 border-r-2 border-slate-100">
            <Calendar size={18} className="text-slate-400" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-transparent text-base font-black text-slate-800 focus:outline-none"
            />
          </div>
          <Button onClick={() => fetchDay(date)} disabled={loading} variant="ghost" className="px-5 py-2.5 text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-all">
            {loading ? "..." : "Sync"}
          </Button>
        </div>
        <a
          href="/cash/close"
          className="ml-auto rounded-2xl bg-slate-900 px-6 py-3.5 text-[11px] font-black uppercase tracking-[0.2em] text-white hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/10 active:scale-95 flex items-center gap-2"
        >
          <Lock size={14} /> Close Cash Day
        </a>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-6 md:grid-cols-3">
        <StatCard label="Current Balance" value={fmt(balance)} color="emerald" icon={IndianRupee} />
        <StatCard label="Audit Events" value={String(events.length)} color="indigo" icon={Activity} />
        <StatCard label="Registry Status" value={isClosed ? "CLOSED" : "OPEN"} color={isClosed ? "rose" : "emerald"} icon={isClosed ? Lock : Unlock} />
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border-2 border-red-100 bg-red-50 p-5 text-sm font-black text-red-700 animate-in fade-in slide-in-from-top-4">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="py-3 text-center text-slate-400 font-black uppercase tracking-[0.2em] text-[11px]">Syncing Registry Data…</div>
      ) : events.length === 0 ? (
        <div className="py-3 text-center text-slate-400 font-black uppercase tracking-[0.2em] text-[11px] border-4 border-slate-50 border-dashed rounded-xl">No movements recorded for this date.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border-2 border-slate-50 shadow-sm bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-[11px] font-black uppercase tracking-widest text-slate-500 border-b-2 border-slate-50">
              <tr>
                <th className="px-6 py-5">Audit Timestamp</th>
                <th className="px-6 py-5">Event Type</th>
                <th className="px-6 py-5">Notes / Context</th>
                <th className="px-6 py-5 text-right">Magnitude</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-50">
              {events.map((e) => (
                <tr key={e.id} className="group hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-5 text-slate-400 font-bold">{new Date(e.occurredAt).toLocaleString("en-IN", { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</td>
                  <td className="px-6 py-5">
                    <span className="rounded-lg bg-slate-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-600 border border-slate-200">{e.kind}</span>
                  </td>
                  <td className="px-6 py-5 font-bold text-slate-700">{e.notes ?? "—"}</td>
                  <td className={`px-6 py-5 text-right font-black text-lg ${Number(e.amount) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(e.amount)}</td>
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
