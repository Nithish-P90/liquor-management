"use client"

import { useCallback, useEffect, useState } from "react"

import { PageShell } from "@/components/PageShell"

type View = "summary" | "bills" | "voids" | "expenses" | "top-sellers" | "clerks" | "audit"

function today(): string { return new Date().toISOString().slice(0, 10) }
function sevenDaysAgo(): string {
  const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10)
}

function fmt(v: string | number): string {
  return "₹" + Number(v).toFixed(2)
}

export default function LedgerPage(): JSX.Element {
  const [from, setFrom] = useState(sevenDaysAgo())
  const [to, setTo] = useState(today())
  const [view, setView] = useState<View>("summary")
  const [data, setData] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)

  const fetch_ = useCallback(async (v: View, f: string, t: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/ledger?from=${f}&to=${t}&view=${v}`)
      setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetch_(view, from, to) }, [view, from, to, fetch_])

  const VIEWS: { key: View; label: string }[] = [
    { key: "summary", label: "Summary" },
    { key: "bills", label: "Bills" },
    { key: "voids", label: "Voids" },
    { key: "expenses", label: "Expenses" },
    { key: "top-sellers", label: "Top Sellers" },
    { key: "clerks", label: "Clerks" },
    { key: "audit", label: "Audit Log" },
  ]

  return (
    <PageShell title="Ledger" subtitle="Filterable multi-view owner dashboard.">
      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none" />
        </div>
        <a
          href={`/api/ledger?from=${from}&to=${to}&view=${view}&format=csv`}
          className="ml-auto rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
        >
          Export CSV
        </a>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-800 pb-3">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${view === v.key ? "bg-emerald-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <LedgerView view={view} data={data} />
      )}
    </PageShell>
  )
}

function LedgerView({ view, data }: { view: View; data: unknown }): JSX.Element {
  if (!data) return <p className="text-sm text-slate-400">No data.</p>

  if (view === "summary") {
    const d = data as { billCount: number; grossTotal: string; discountTotal: string; netCollectible: string; byMode: Record<string, string> }
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Bills", value: String(d.billCount) },
          { label: "Gross Total", value: fmt(d.grossTotal) },
          { label: "Discounts", value: fmt(d.discountTotal) },
          { label: "Net Collected", value: fmt(d.netCollectible) },
          ...Object.entries(d.byMode).map(([mode, amount]) => ({ label: mode, value: fmt(amount) })),
        ].map((card) => (
          <div key={card.label} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs text-slate-400">{card.label}</p>
            <p className="mt-1 text-xl font-bold text-slate-100">{card.value}</p>
          </div>
        ))}
      </div>
    )
  }

  if (view === "bills") {
    const bills = data as Array<{ id: number; billNumber: string; billedAt: string; netCollectible: string; status: string; operator: { name: string }; lines: Array<{ itemNameSnapshot: string; quantity: number }> }>
    return (
      <div className="overflow-hidden rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/60">
            <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
              <th className="px-4 py-3">Bill No</th>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Operator</th>
              <th className="px-4 py-3">Items</th>
              <th className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => (
              <tr key={b.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                <td className="px-4 py-3 font-mono text-xs text-slate-200">{b.billNumber}</td>
                <td className="px-4 py-3 text-slate-400">{new Date(b.billedAt).toLocaleTimeString("en-IN")}</td>
                <td className="px-4 py-3 text-slate-300">{b.operator.name}</td>
                <td className="px-4 py-3 text-slate-400">{b.lines.length} lines</td>
                <td className="px-4 py-3 text-right font-medium text-emerald-400">{fmt(b.netCollectible)}</td>
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
      <div className="overflow-hidden rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/60">
            <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3 text-right">Qty Sold</th>
              <th className="px-4 py-3 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {sellers.map((s, i) => (
              <tr key={i} className="border-t border-slate-800 hover:bg-slate-800/30">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-100">{s.productSize?.product.name ?? "Unknown"}</p>
                  <p className="text-xs text-slate-400">{s.productSize?.sizeMl}ml</p>
                </td>
                <td className="px-4 py-3 text-right text-slate-300">{s.totalQty}</td>
                <td className="px-4 py-3 text-right font-medium text-emerald-400">{fmt(s.totalRevenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (view === "expenses") {
    const { expenses, total } = data as { expenses: Array<{ id: number; expDate: string; particulars: string; category: string; amount: string; categoryRef?: { name: string } | null }>; total: string }
    return (
      <div>
        <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs text-slate-400">Total Expenses</p>
          <p className="text-2xl font-bold text-red-400">{fmt(total)}</p>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60">
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Particulars</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-t border-slate-800">
                  <td className="px-4 py-3 text-slate-400">{e.expDate.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-slate-200">{e.particulars}</td>
                  <td className="px-4 py-3 text-slate-400">{e.categoryRef?.name ?? e.category}</td>
                  <td className="px-4 py-3 text-right font-medium text-red-400">{fmt(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  if (view === "audit") {
    const events = data as Array<{ id: string; eventType: string; entity: string; entityId: number; occurredAt: string; actor?: { name: string } | null; reason?: string | null }>
    return (
      <div className="overflow-hidden rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/60">
            <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Reason</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={String(e.id)} className="border-t border-slate-800">
                <td className="px-4 py-3 text-xs text-slate-400">{new Date(e.occurredAt).toLocaleString("en-IN")}</td>
                <td className="px-4 py-3 text-slate-300">{e.actor?.name ?? "System"}</td>
                <td className="px-4 py-3 font-mono text-xs text-amber-400">{e.eventType}</td>
                <td className="px-4 py-3 text-slate-400">{e.entity}#{e.entityId}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{e.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (view === "voids") {
    const bills = data as Array<{ id: number; billNumber: string; voidReason: string | null; operator: { name: string }; voidedBy?: { name: string } | null; voidedAt?: string | null; netCollectible: string }>
    return (
      <div className="overflow-hidden rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/60">
            <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
              <th className="px-4 py-3">Bill No</th>
              <th className="px-4 py-3">Operator</th>
              <th className="px-4 py-3">Voided By</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => (
              <tr key={b.id} className="border-t border-slate-800">
                <td className="px-4 py-3 font-mono text-xs text-slate-200">{b.billNumber}</td>
                <td className="px-4 py-3 text-slate-300">{b.operator.name}</td>
                <td className="px-4 py-3 text-slate-300">{b.voidedBy?.name ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{b.voidReason ?? "—"}</td>
                <td className="px-4 py-3 text-right text-red-400">{fmt(b.netCollectible)}</td>
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
      <div className="overflow-hidden rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/60">
            <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
              <th className="px-4 py-3">Clerk ID</th>
              <th className="px-4 py-3">Bills</th>
              <th className="px-4 py-3 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {clerks.map((c, i) => (
              <tr key={i} className="border-t border-slate-800">
                <td className="px-4 py-3 text-slate-300">{c.clerkId ?? "Counter"}</td>
                <td className="px-4 py-3 text-slate-300">{c._count.id}</td>
                <td className="px-4 py-3 text-right font-medium text-emerald-400">{fmt(c._sum.netCollectible ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return <pre className="text-xs text-slate-400">{JSON.stringify(data, null, 2)}</pre>
}
