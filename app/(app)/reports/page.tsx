"use client"

import { useState } from "react"
import Link from "next/link"

import { Button } from "@/components/ui/Button"
import { PageShell } from "@/components/PageShell"

function today(): string { return new Date().toISOString().slice(0, 10) }
function sevenDaysAgo(): string { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10) }
function monthStart(): string { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10) }

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
    try {
      const res = await fetch(report.apiPath(from, to))
      const data = await res.json()

      if (selectedReport === "daily-sales") {
        const d = data as Record<string, unknown>
        const mapped = [
          ["Bill Count", String(d.billCount)],
          ["Gross Total", `₹${Number(d.grossTotal).toFixed(2)}`],
          ["Discounts", `₹${Number(d.discountTotal).toFixed(2)}`],
          ["Net Collected", `₹${Number(d.netCollectible).toFixed(2)}`],
          ...Object.entries((d.byMode ?? {}) as Record<string, string>).map(([mode, amount]) => [mode, `₹${Number(amount).toFixed(2)}`]),
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
    <PageShell title="Reports" subtitle="Generate and export operational reports.">
      <div className="mb-6 flex flex-wrap gap-2">
        {Object.entries(REPORTS).map(([key, r]) => (
          <button
            key={key}
            onClick={() => setSelectedReport(key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${selectedReport === key ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"}`}
          >
            {r.title}
          </button>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-4">
        {["from", "to"].map((field) => (
          <div key={field} className="flex items-center gap-2">
            <label className="text-xs capitalize text-slate-400">{field}</label>
            <input
              type="date"
              value={field === "from" ? from : to}
              onChange={(e) => field === "from" ? setFrom(e.target.value) : setTo(e.target.value)}
              className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        ))}
        <Button onClick={runReport} disabled={loading}>{loading ? "Loading…" : "Run Report"}</Button>
        {rows.length > 0 && (
          <Button variant="secondary" onClick={downloadCsv}>Export CSV</Button>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60">
              <tr>
                {report.columns.map((col) => (
                  <th key={col} className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-slate-800 hover:bg-slate-800/30">
                  {row.map((cell, j) => (
                    <td key={j} className="px-4 py-3 text-slate-200">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Select a report and click "Run Report".</p>
      )}
    </PageShell>
  )
}
