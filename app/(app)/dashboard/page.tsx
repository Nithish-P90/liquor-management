import Link from "next/link"
import { TrendingUp, ShoppingBag, CreditCard, AlertTriangle, BarChart3, Package } from "lucide-react"

import { prisma } from "@/lib/prisma"
import { listActiveAlerts } from "@/lib/alerts"
import { todayDateString } from "@/lib/dates"
import { getSalesSummary } from "@/lib/ledger"
import { getTopSellingItems, getSalesByPaymentMode } from "@/lib/analytics"

export default async function DashboardPage(): Promise<JSX.Element> {
  const today = todayDateString()

  const [summary, alerts, openTabs, activeBatches, topItems, paymentStats] = await Promise.all([
    getSalesSummary({ from: today, to: today }).catch(() => null),
    listActiveAlerts(10).catch(() => []),
    prisma.bill.count({ where: { status: "TAB_OPEN" } }).catch(() => 0),
    prisma.clearanceBatch.count({ where: { status: "ACTIVE" } }).catch(() => 0),
    getTopSellingItems(5).catch(() => []),
    getSalesByPaymentMode().catch(() => []),
  ])

  const stats = [
    { label: "Today's Bills", value: String(summary?.billCount ?? 0), icon: ShoppingBag, trend: "+12%" },
    { label: "Today's Revenue", value: summary ? `₹${Number(summary.netCollectible).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : "₹0.00", icon: TrendingUp, trend: "+8%" },
    { label: "Open Tabs", value: String(openTabs), icon: CreditCard, color: openTabs > 0 ? "text-amber-500" : "text-slate-400" },
    { label: "In-Progress Clearances", value: String(activeBatches), icon: Package },
  ]

  return (
    <main className="min-h-screen bg-[#f8fafc] p-6 lg:p-10">
      <header className="mb-10 flex items-end justify-between border-b border-slate-200 pb-8">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Operations Console</h1>
          <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-500 uppercase tracking-wider">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Active Session • {today}
          </p>
        </div>
        <div className="flex gap-3">
           <Link href="/pos" className="flex items-center gap-2 rounded-lg bg-slate-900 px-6 py-3 text-sm font-bold text-white transition hover:bg-slate-800 active:scale-95">
              <ShoppingBag size={18} />
              OPEN POS
           </Link>
        </div>
      </header>

      {/* Primary Stats Grid */}
      <div className="mb-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="group relative rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:shadow-md">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">{stat.label}</p>
                <p className={`mt-2 text-3xl font-black tracking-tight ${stat.color || "text-slate-900"}`}>{stat.value}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-2.5 text-slate-400 group-hover:text-slate-900 transition-colors">
                <stat.icon size={20} />
              </div>
            </div>
            {stat.trend && (
              <div className="mt-4 flex items-center gap-1.5 text-xs font-bold text-emerald-600">
                <TrendingUp size={14} />
                {stat.trend} <span className="font-medium text-slate-400">vs yesterday</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
        {/* Left Column: Analytics */}
        <div className="space-y-10 lg:col-span-2">
          {/* Top Selling Items */}
          <section className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
            <div className="flex items-center justify-between p-4 px-5">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-900">
                <BarChart3 size={18} className="text-slate-400" />
                Performance Leaderboard
              </h2>
              <Link href="/reports" className="text-xs font-bold text-slate-900 hover:underline">Full Analytics</Link>
            </div>
            <div className="overflow-hidden border-t border-slate-100">
              <table className="w-full text-left">
                <thead className="bg-slate-50/50 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <tr>
                    <th className="px-5 py-4">Item</th>
                    <th className="px-5 py-4">Category</th>
                    <th className="px-5 py-4 text-right">Units</th>
                    <th className="px-5 py-4 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {topItems.length > 0 ? topItems.map((item, i) => (
                    <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-4 text-sm font-bold text-slate-800">
                        {item.productSize
                          ? `${item.productSize.product.name} ${item.productSize.sizeMl}ml`
                          : "Unknown"}
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-500 font-medium">{item.productSize?.product.category}</td>
                      <td className="px-5 py-4 text-right text-sm font-mono font-bold text-slate-600">{item.totalQuantity}</td>
                      <td className="px-5 py-4 text-right text-sm font-mono font-bold text-slate-900">₹{item.totalRevenue.toFixed(2)}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={4} className="px-5 py-10 text-center text-slate-400 text-xs font-medium">No sales data recorded yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Quick Actions Grid */}
          <section>
            <h2 className="mb-6 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 text-center">System Management</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {[
                { href: "/cash/close", label: "Cash Close", icon: CreditCard },
                { href: "/ledger", label: "Financials", icon: BarChart3 },
                { href: "/indents", label: "Inventory Opt", icon: Package },
                { href: "/inventory", label: "Stock Control", icon: Package },
                { href: "/expenses", label: "Log Costs", icon: TrendingUp },
                { href: "/reports", label: "Operations", icon: BarChart3 },
              ].map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white py-8 transition hover:border-slate-900 hover:shadow-sm"
                >
                  <link.icon size={20} className="text-slate-400" />
                  <span className="text-xs font-bold text-slate-900 uppercase tracking-tight">{link.label}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>

        {/* Right Column: Alerts & Status */}
        <div className="space-y-10">
          {/* Revenue Breakdown */}
          <section className="rounded-xl border border-slate-200 bg-slate-900 p-6 shadow-sm">
            <h2 className="mb-6 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Net Distribution</h2>
            <div className="space-y-5">
              {paymentStats.map((stat, i) => (
                <div key={i} className="flex items-center justify-between border-b border-slate-800 pb-4 last:border-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-slate-200">{stat.mode}</span>
                  </div>
                  <span className="font-mono text-sm font-bold text-white">₹{(stat._sum.amount ?? 0).toString()}</span>
                </div>
              ))}
              {paymentStats.length === 0 && <p className="text-center text-xs font-medium text-slate-600 py-4">Nil distributions</p>}
            </div>
          </section>

          {/* Critical Alerts */}
          <section>
             <div className="mb-6 flex items-center justify-between">
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                Operational Exceptions
              </h2>
            </div>
            <div className="space-y-4">
              {alerts.length > 0 ? alerts.map((alert) => (
                <div key={alert.id} className={`flex items-start gap-4 rounded-xl border p-5 transition ${
                  alert.severity === "CRITICAL" ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"
                }`}>
                  <AlertTriangle size={18} className={alert.severity === "CRITICAL" ? "text-red-600" : "text-slate-900"} />
                  <div>
                    <p className={`text-sm font-bold ${alert.severity === "CRITICAL" ? "text-red-900" : "text-slate-900"}`}>{alert.title}</p>
                    <p className={`mt-1 text-xs font-medium leading-relaxed ${alert.severity === "CRITICAL" ? "text-red-700" : "text-slate-500"}`}>{alert.body}</p>
                  </div>
                </div>
              )) : (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 py-12 text-center">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Normal Operations</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
