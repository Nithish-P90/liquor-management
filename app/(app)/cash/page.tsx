"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

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
    <PageShell title="Cash Register" subtitle="Read-only view of galla balance and events.">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-slate-600">Business date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <Button onClick={() => fetchDay(date)} disabled={loading} variant="secondary">
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
        <a
          href="/cash/close"
          className="ml-auto rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Close cash day
        </a>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatCard label="Balance" value={fmt(balance)} />
        <StatCard label="Events" value={String(events.length)} />
        <StatCard label="Status" value={isClosed ? "Closed" : "Open"} subtle={!isClosed} />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !data ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-slate-500">No events for this date.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-slate-200">
                  <td className="px-4 py-3 text-slate-500">{new Date(e.occurredAt).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{e.kind}</td>
                  <td className="px-4 py-3 text-slate-700">{e.notes ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  )
}

function StatCard({ label, value, subtle }: { label: string; value: string; subtle?: boolean }): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-extrabold ${subtle ? "text-slate-600" : "text-slate-900"}`}>{value}</p>
    </div>
  )
}
