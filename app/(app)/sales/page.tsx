"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

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
    <PageShell title="Sales" subtitle="Recent bills (committed/voided) with quick totals.">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search bill / operator / clerk..."
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <select
          value={show}
          onChange={(e) => setShow(e.target.value as typeof show)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
        >
          <option value="ALL">All</option>
          <option value="COMMITTED">Committed</option>
          <option value="VOIDED">Voided</option>
        </select>
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
        >
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
        <Button onClick={fetchBills} disabled={loading} variant="secondary">
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
        <a
          href="/pos"
          className="ml-auto rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Open POS
        </a>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-5">
        <StatCard label="Bills" value={String(totals.count)} />
        <StatCard label="Committed" value={String(totals.committedCount)} />
        <StatCard label="Gross" value={fmt(totals.gross)} />
        <StatCard label="Discounts" value={fmt(totals.discounts)} />
        <StatCard label="Net" value={fmt(totals.net)} />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && filtered.length === 0 ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-500">No bills to show.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Bill</th>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Attribution</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.id} className="border-t border-slate-200">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">{b.billNumber}</td>
                  <td className="px-4 py-3 text-slate-600">{new Date(b.billedAt).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {b.clerk?.name ? `Clerk • ${b.clerk.name}` : "Counter"} • {b.operator?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                        b.status === "VOIDED" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {b.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(b.netCollectible)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  )
}

function StatCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-extrabold text-slate-900">{value}</p>
    </div>
  )
}
