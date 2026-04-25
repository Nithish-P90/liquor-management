import Link from "next/link"

import { prisma } from "@/lib/prisma"
import { listActiveAlerts } from "@/lib/alerts"
import { todayDateString } from "@/lib/dates"
import { getSalesSummary } from "@/lib/ledger"

export default async function DashboardPage(): Promise<JSX.Element> {
  const today = todayDateString()

  const [summary, alerts, openTabs, activeBatches] = await Promise.all([
    getSalesSummary({ from: today, to: today }).catch(() => null),
    listActiveAlerts(10).catch(() => []),
    prisma.bill.count({ where: { status: "TAB_OPEN" } }).catch(() => 0),
    prisma.clearanceBatch.count({ where: { status: "ACTIVE" } }).catch(() => 0),
  ])

  const stats = [
    { label: "Today's Bills", value: String(summary?.billCount ?? 0) },
    { label: "Today's Revenue", value: summary ? `₹${Number(summary.netCollectible).toFixed(2)}` : "—" },
    { label: "Open Tabs", value: String(openTabs) },
    { label: "Active Clearances", value: String(activeBatches) },
  ]

  return (
    <main className="min-h-screen p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-100">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-400">{today}</p>
      </header>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs text-slate-400">{stat.label}</p>
            <p className="mt-1 text-2xl font-bold text-slate-100">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Quick links */}
      <div className="mb-8 grid grid-cols-3 gap-4">
        {[
          { href: "/pos", label: "Open POS", color: "bg-emerald-600 hover:bg-emerald-500" },
          { href: "/cash/close", label: "Cash Close", color: "bg-blue-600 hover:bg-blue-500" },
          { href: "/ledger", label: "View Ledger", color: "bg-slate-700 hover:bg-slate-600" },
          { href: "/indents", label: "KSBCL Indents", color: "bg-slate-700 hover:bg-slate-600" },
          { href: "/expenses", label: "Log Expense", color: "bg-slate-700 hover:bg-slate-600" },
          { href: "/reports", label: "Reports", color: "bg-slate-700 hover:bg-slate-600" },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`flex h-16 items-center justify-center rounded-lg text-sm font-medium text-white transition ${link.color}`}
          >
            {link.label}
          </Link>
        ))}
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <section className="rounded-lg border border-amber-800/50 bg-amber-900/10 p-4">
          <h2 className="mb-3 text-sm font-semibold text-amber-300">Active Alerts</h2>
          <div className="space-y-2">
            {alerts.map((alert) => (
              <div key={alert.id} className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <span className={`mt-0.5 h-2 w-2 flex-shrink-0 rounded-full ${alert.severity === "CRITICAL" ? "bg-red-500" : alert.severity === "WARN" ? "bg-amber-500" : "bg-blue-500"}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-100">{alert.title}</p>
                  <p className="text-xs text-slate-400">{alert.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
