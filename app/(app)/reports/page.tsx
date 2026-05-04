"use client"

import { useState } from "react"

import { Calendar, BarChart3 } from "lucide-react"

import { Button } from "@/components/ui/Button"
import { PageShell } from "@/components/PageShell"

function today(): string { return new Date().toISOString().slice(0, 10) }
function sevenDaysAgo(): string { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10) }

type ReportConfig = {
  title: string
  description: string
  apiPath: (from: string, to: string) => string
  columns: string[]
  rowMapper: (row: unknown) => (string | number)[]
}

const REPORTS: Record<string, ReportConfig> = {
  "daily-sales": {
    title: "Daily Sales Summary",
    description: "Total bills, revenue by payment mode per day",
    apiPath: (from, to) => `/api/ledger?view=summary&from=${from}&to=${to}`,
    columns: ["Metric", "Value"],
    rowMapper: (d: unknown) => {
      const data = d as Record<string, unknown>
      return [String(data.key ?? ""), String(data.value ?? "")]
    },
  },
  "top-sellers": {
    title: "Top Sellers",
    description: "Products ranked by volume sold",
    apiPath: (from, to) => `/api/ledger?view=top-sellers&from=${from}&to=${to}`,
    columns: ["Product", "Size", "Qty Sold", "Revenue"],
    rowMapper: (r: unknown) => {
      const row = r as { productSize?: { sizeMl: number; product: { name: string } }; totalQty: number; totalRevenue: string }
      return [
        row.productSize?.product.name ?? "Unknown",
        `${row.productSize?.sizeMl ?? 0}ml`,
        row.totalQty,
        `₹${Number(row.totalRevenue).toFixed(2)}`,
      ]
    },
  },
  "voids": {
    title: "Void Report",
    description: "All voided bills with reasons",
    apiPath: (from, to) => `/api/ledger?view=voids&from=${from}&to=${to}`,
    columns: ["Bill No", "Operator", "Voided By", "Reason", "Amount"],
    rowMapper: (r: unknown) => {
      const row = r as { billNumber: string; operator: { name: string }; voidedBy?: { name: string } | null; voidReason?: string | null; netCollectible: string }
      return [row.billNumber, row.operator.name, row.voidedBy?.name ?? "—", row.voidReason ?? "—", `₹${Number(row.netCollectible).toFixed(2)}`]
    },
  },
  "expenses": {
    title: "Expense Report",
    description: "All expenses by category",
    apiPath: (from, to) => `/api/expenses?from=${from}&to=${to}`,
    columns: ["Date", "Particulars", "Category", "Amount"],
    rowMapper: (r: unknown) => {
      const row = r as { expDate: string; particulars: string; categoryRef?: { name: string } | null; category: string; amount: string }
      return [row.expDate.slice(0, 10), row.particulars, row.categoryRef?.name ?? row.category, `₹${Number(row.amount).toFixed(2)}`]
    },
  },
  "clerk-performance": {
    title: "Clerk Performance",
    description: "Bills and revenue per clerk",
    apiPath: (from, to) => `/api/ledger?view=clerks&from=${from}&to=${to}`,
    columns: ["Clerk ID", "Bills", "Revenue"],
    rowMapper: (r: unknown) => {
      const row = r as { clerkId: number | null; _count: { id: number }; _sum: { netCollectible: string | null } }
      return [row.clerkId ?? "Counter", row._count.id, `₹${Number(row._sum.netCollectible ?? 0).toFixed(2)}`]
    },
  },
  "audit": {
    title: "Audit Log",
    description: "All system events with actors",
    apiPath: (from, to) => `/api/ledger?view=audit&from=${from}&to=${to}`,
    columns: ["Time", "Actor", "Event", "Entity"],
    rowMapper: (r: unknown) => {
      const row = r as { occurredAt: string; actor?: { name: string } | null; eventType: string; entity: string; entityId: number }
      return [new Date(row.occurredAt).toLocaleString("en-IN"), row.actor?.name ?? "System", row.eventType, `${row.entity}#${row.entityId}`]
    },
  },
}

export default function ReportsPage(): JSX.Element {
  const [selectedReport, setSelectedReport] = useState("top-sellers")
  const [from, setFrom] = useState(sevenDaysAgo())
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState<Array<(string | number)[]>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const report = REPORTS[selectedReport]!

  async function runReport(): Promise<void> {
    setLoading(true)
    setError("")
    setRows([])
    try {
      const res = await fetch(report.apiPath(from, to))
      const data = await res.json()

      if (selectedReport === "daily-sales") {
        const d = data as Record<string, unknown>
        const mapped = [
          ["Sequential Bill Count", String(d.billCount)],
          ["Gross System Total", `₹${Number(d.grossTotal).toFixed(2)}`],
          ["Net Collectible Cash", `₹${Number(d.netCollectible).toFixed(2)}`],
          ["Owner Settlement Payout", `₹${Number(d.ownerRevenue ?? 0).toFixed(2)}`],
          ["Third-Party Share", `₹${Number(d.thirdPartyTotal ?? 0).toFixed(2)}`],
          ...Object.entries((d.byMode ?? {}) as Record<string, string>).map(([mode, amount]) => [`MOP: ${mode}`, `₹${Number(amount).toFixed(2)}`]),
        ] as [string, string][]
        setRows(mapped)
      } else {
        const arr = Array.isArray(data) ? data : (data.expenses ?? [])
        setRows(arr.map(report.rowMapper))
      }
    } catch {
      setError("Failed to load report")
    } finally {
      setLoading(false)
    }
  }

  function downloadCsv(): void {
    const header = report.columns.join(",")
    const body = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${selectedReport}-${from}-to-${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <PageShell title="Business Intelligence" subtitle="Generate strategic operational reports and enterprise audit logs.">
      <div className="mb-4 flex flex-wrap gap-3 border-b-2 border-slate-50 pb-8">
        {Object.entries(REPORTS).map(([key, r]) => (
          <button
            key={key}
            onClick={() => setSelectedReport(key)}
            className={`rounded-2xl px-6 py-3 text-[11px] font-black uppercase tracking-[0.2em] transition-all shadow-md active:scale-95 ${
              selectedReport === key 
                ? "bg-slate-900 text-white shadow-slate-900/20" 
                : "bg-white text-slate-500 border-2 border-slate-50 hover:border-indigo-300 hover:text-indigo-600"
            }`}
          >
            {r.title}
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-6 bg-white border-2 border-slate-100 p-4 rounded-xl shadow-sm">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 pl-2">
            <Calendar size={18} className="text-slate-400" />
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-transparent text-base font-black text-slate-800 focus:outline-none"
            />
          </div>
          <div className="h-6 w-px bg-slate-200" />
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="bg-transparent text-base font-black text-slate-800 focus:outline-none"
            />
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Button onClick={runReport} disabled={loading} className="rounded-2xl px-4 py-4 font-black uppercase tracking-widest text-[11px] shadow-xl shadow-indigo-600/10">
            {loading ? "..." : "Compile Report"}
          </Button>
          {rows.length > 0 && (
            <Button variant="secondary" onClick={downloadCsv} className="rounded-2xl px-6 py-4 font-black uppercase tracking-widest text-[11px] border-2 border-slate-100">
              Export CSV
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border-2 border-red-100 bg-red-50 p-5 text-sm font-black text-red-700 animate-in fade-in">
          {error}
        </div>
      )}

      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-xl border-2 border-slate-50 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 border-b-2 border-slate-50">
              <tr>
                {report.columns.map((col) => (
                  <th key={col} className="px-6 py-5">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-50">
              {rows.map((row, i) => (
                <tr key={i} className="group hover:bg-slate-50 transition-colors">
                  {row.map((cell, j) => (
                    <td key={j} className={`px-6 py-5 font-black text-slate-800 ${j === 0 ? "text-base" : "text-sm"}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="py-3 text-center border-4 border-slate-50 border-dashed rounded-xl">
          <div className="flex flex-col items-center gap-4 text-slate-400">
            <BarChart3 size={48} className="opacity-20" />
            <p className="text-[11px] font-black uppercase tracking-[0.2em]">Select analytical module and compile</p>
          </div>
        </div>
      )}
    </PageShell>
  )
}
