"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

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
    <PageShell title="Pending Bills" subtitle="Open tabs that can be settled from POS.">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search bill number / customer..."
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <Button onClick={fetchTabs} disabled={loading} variant="secondary">
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
        <a
          href="/pos"
          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          Go to POS
        </a>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatCard label="Open Tabs" value={String(filtered.length)} />
        <StatCard label="Total Pending" value={fmt(totalPending)} />
        <StatCard label="Hint" value="Settle from POS → Tabs" subtle />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && filtered.length === 0 ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-500">No open tabs.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((b) => (
            <div key={b.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm font-semibold text-slate-900">{b.billNumber}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {b.customerName ?? "Walk-in"}
                    {b.customerPhone ? ` • ${b.customerPhone}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Opened {new Date(b.billedAt).toLocaleString("en-IN")} • {b.clerk?.name ?? "Counter"} •{" "}
                    {b.operator?.name ?? "—"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Due</p>
                  <p className="text-2xl font-extrabold text-emerald-700">{fmt(b.netCollectible)}</p>
                </div>
              </div>

              <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.lines.map((l) => (
                      <tr key={l.id} className="border-t border-slate-200">
                        <td className="px-3 py-2 text-slate-800">{l.itemNameSnapshot}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{l.quantity}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-900">{fmt(l.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
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
