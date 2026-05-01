"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"

type View = "summary" | "bills" | "voids" | "expenses" | "top-sellers" | "clerks" | "audit"

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmt(v: string | number): string {
  return "₹" + Number(v).toFixed(2)
}

export default function Page(): JSX.Element {
  const [date, setDate] = useState(today())
  const [view, setView] = useState<View>("summary")
  const [data, setData] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch_ = useCallback(async (v: View, d: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ledger?from=${d}&to=${d}&view=${v}&limit=200`, { cache: "no-store" })
      if (!res.ok) throw new Error("Failed to load report")
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetch_(view, date)
  }, [fetch_, view, date])

  const VIEWS: { key: View; label: string }[] = useMemo(
    () => [
      { key: "summary", label: "Summary" },
      { key: "bills", label: "Bills" },
      { key: "voids", label: "Voids" },
      { key: "expenses", label: "Expenses" },
      { key: "top-sellers", label: "Top Sellers" },
      { key: "clerks", label: "Clerks" },
      { key: "audit", label: "Audit" },
    ],
    [],
  )

  return (
    <PageShell title="Daily Report" subtitle="Date-scoped ledger views (admin).">
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
        <Button onClick={() => fetch_(view, date)} disabled={loading} variant="secondary">
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
        <a
          href={`/api/ledger?from=${date}&to=${date}&view=${view}`}
          className="ml-auto rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Raw export (JSON)
        </a>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              view === v.key ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? <p className="text-sm text-slate-500">Loading…</p> : <DailyView view={view} data={data} />}
    </PageShell>
  )
}

function DailyView({ view, data }: { view: View; data: unknown }): JSX.Element {
  if (!data) return <p className="text-sm text-slate-500">No data.</p>

  if (view === "summary") {
    const d = data as { billCount: number; grossTotal: string; discountTotal: string; netCollectible: string; byMode: Record<string, string> }
    const cards = [
      { label: "Bills", value: String(d.billCount) },
      { label: "Gross", value: fmt(d.grossTotal) },
      { label: "Discounts", value: fmt(d.discountTotal) },
      { label: "Net", value: fmt(d.netCollectible) },
      ...Object.entries(d.byMode ?? {}).map(([mode, amount]) => ({ label: mode, value: fmt(amount) })),
    ]
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{c.label}</p>
            <p className="mt-1 text-xl font-extrabold text-slate-900">{c.value}</p>
          </div>
        ))}
      </div>
    )
  }

  if (view === "bills") {
    const bills = data as Array<{ id: number; billNumber: string; billedAt: string; netCollectible: string; operator: { name: string }; clerk: { name: string } | null; lines: Array<{ id: number; itemNameSnapshot: string; quantity: number; lineTotal: string }> }>
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Bill</th>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Operator</th>
              <th className="px-4 py-3">Lines</th>
              <th className="px-4 py-3 text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => (
              <tr key={b.id} className="border-t border-slate-200">
                <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">{b.billNumber}</td>
                <td className="px-4 py-3 text-slate-600">{new Date(b.billedAt).toLocaleString("en-IN")}</td>
                <td className="px-4 py-3 text-slate-700">{b.clerk?.name ? `Clerk • ${b.clerk.name}` : "Counter"} • {b.operator.name}</td>
                <td className="px-4 py-3 text-slate-600">{b.lines.length}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(b.netCollectible)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (view === "expenses") {
    const { expenses, total } = data as { expenses: Array<{ id: number; expDate: string; particulars: string; amount: string; categoryRef?: { name: string } | null; category: string }>; total: string }
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total expenses</p>
          <p className="mt-1 text-2xl font-extrabold text-red-600">{fmt(total)}</p>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Particulars</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-t border-slate-200">
                  <td className="px-4 py-3 text-slate-600">{e.expDate.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-slate-800">{e.particulars}</td>
                  <td className="px-4 py-3 text-slate-700">{e.categoryRef?.name ?? e.category}</td>
                  <td className="px-4 py-3 text-right font-semibold text-red-600">{fmt(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  if (view === "voids") {
    const bills = data as Array<{ id: number; billNumber: string; operator: { name: string }; voidedBy?: { name: string } | null; voidReason: string | null; netCollectible: string }>
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Bill</th>
              <th className="px-4 py-3">Operator</th>
              <th className="px-4 py-3">Voided by</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => (
              <tr key={b.id} className="border-t border-slate-200">
                <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">{b.billNumber}</td>
                <td className="px-4 py-3 text-slate-700">{b.operator.name}</td>
                <td className="px-4 py-3 text-slate-700">{b.voidedBy?.name ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{b.voidReason ?? "—"}</td>
                <td className="px-4 py-3 text-right font-semibold text-red-600">{fmt(b.netCollectible)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (view === "top-sellers") {
    const sellers = data as Array<{ productSize?: { sizeMl: number; product: { name: string; category: string } }; totalQty: number; totalRevenue: string }>
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {sellers.map((s, i) => (
              <tr key={i} className="border-t border-slate-200">
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-900">{s.productSize?.product.name ?? "Unknown"}</p>
                  <p className="text-xs text-slate-500">{s.productSize?.sizeMl}ml • {s.productSize?.product.category}</p>
                </td>
                <td className="px-4 py-3 text-right text-slate-700">{s.totalQty}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(s.totalRevenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (view === "clerks") {
    const clerks = data as Array<{ clerkId: number | null; _count: { id: number }; _sum: { netCollectible: string | null } }>
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Clerk ID</th>
              <th className="px-4 py-3">Bills</th>
              <th className="px-4 py-3 text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {clerks.map((c, i) => (
              <tr key={i} className="border-t border-slate-200">
                <td className="px-4 py-3 text-slate-700">{c.clerkId}</td>
                <td className="px-4 py-3 text-slate-700">{c._count.id}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(c._sum.netCollectible ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (view === "audit") {
    const events = data as Array<{ id: string; occurredAt: string; actor?: { name: string } | null; eventType: string; entity: string; entityId: number; reason?: string | null }>
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Reason</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={String(e.id)} className="border-t border-slate-200">
                <td className="px-4 py-3 text-slate-600">{new Date(e.occurredAt).toLocaleString("en-IN")}</td>
                <td className="px-4 py-3 text-slate-700">{e.actor?.name ?? "System"}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-700">{e.eventType}</td>
                <td className="px-4 py-3 text-slate-700">{e.entity}#{e.entityId}</td>
                <td className="px-4 py-3 text-slate-600">{e.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return <pre className="text-xs text-slate-600">{JSON.stringify(data, null, 2)}</pre>
}
