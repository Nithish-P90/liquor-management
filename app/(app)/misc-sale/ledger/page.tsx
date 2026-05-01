"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"

type BillLine = {
  id: number
  lineNo: number
  sourceType: "LIQUOR" | "MISC" | string
  itemNameSnapshot: string
  quantity: number
  unitPrice: string
  lineTotal: string
  miscItemId: number | null
  miscItem?: { name: string; category: string } | null
  billId: number
}

type BillRow = {
  id: number
  billNumber: string
  billedAt: string
  businessDate: string
  status: string
  netCollectible: string
  operator: { name: string }
  clerk: { name: string } | null
  lines: BillLine[]
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
function sevenDaysAgo(): string {
  const d = new Date()
  d.setDate(d.getDate() - 6)
  return d.toISOString().slice(0, 10)
}

function fmt(v: string | number): string {
  return "₹" + Number(v).toFixed(2)
}

export default function Page(): JSX.Element {
  const [from, setFrom] = useState(sevenDaysAgo())
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState<BillRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch_ = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ledger?from=${from}&to=${to}&view=bills&limit=500`, { cache: "no-store" })
      if (!res.ok) throw new Error("Failed to load ledger data")
      const data = (await res.json()) as BillRow[]
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    void fetch_()
  }, [fetch_])

  const miscLines = useMemo(() => {
    const flat: Array<{
      billNumber: string
      billedAt: string
      operator: string
      clerk: string
      item: string
      category: string
      qty: number
      unitPrice: string
      lineTotal: string
    }> = []

    for (const b of rows) {
      for (const l of b.lines ?? []) {
        if (l.sourceType !== "MISC") continue
        flat.push({
          billNumber: b.billNumber,
          billedAt: b.billedAt,
          operator: b.operator?.name ?? "—",
          clerk: b.clerk?.name ?? "Counter",
          item: l.miscItem?.name ?? l.itemNameSnapshot,
          category: l.miscItem?.category ?? "—",
          qty: l.quantity,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
        })
      }
    }
    return flat
  }, [rows])

  const totals = useMemo(() => {
    const qty = miscLines.reduce((sum, l) => sum + Number(l.qty), 0)
    const amt = miscLines.reduce((sum, l) => sum + Number(l.lineTotal), 0)
    return { qty, amt }
  }, [miscLines])

  return (
    <PageShell title="Misc Sales Ledger" subtitle="Derived from committed bill lines (sourceType=MISC).">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-slate-600">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-slate-600">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <Button onClick={fetch_} disabled={loading} variant="secondary">
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
        <a
          href={`/api/ledger?from=${from}&to=${to}&view=bills&limit=500`}
          className="ml-auto rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Raw bill export (JSON)
        </a>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatCard label="Misc lines" value={String(miscLines.length)} />
        <StatCard label="Qty total" value={String(totals.qty)} />
        <StatCard label="Sales total" value={fmt(totals.amt)} />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && miscLines.length === 0 ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : miscLines.length === 0 ? (
        <p className="text-sm text-slate-500">No misc sales in this range.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Bill</th>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {miscLines.map((l, idx) => (
                <tr key={`${l.billNumber}-${idx}`} className="border-t border-slate-200">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">{l.billNumber}</td>
                  <td className="px-4 py-3 text-slate-600">{new Date(l.billedAt).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-slate-800">{l.item}</td>
                  <td className="px-4 py-3 text-slate-600">{l.category}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{l.qty}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(l.lineTotal)}</td>
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
