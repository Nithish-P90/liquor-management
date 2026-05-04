import Link from "next/link"
import { TrendingUp, ShoppingBag, CreditCard, AlertTriangle, BarChart3, Package, Vault } from "lucide-react"

import { prisma } from "@/lib/prisma"
import { listActiveAlerts } from "@/lib/alerts"
import { todayDateString, parseDateParam } from "@/lib/dates"
import { getSalesSummary } from "@/lib/ledger"
import { getTopSellingItems } from "@/lib/analytics"
import { computeGallaBalance, getOrCreateGallaDay } from "@/lib/domains/cash/galla"
import type { PrismaTransactionClient } from "@/lib/domains/inventory/stock"

export default async function DashboardPage(): Promise<JSX.Element> {
  const today = todayDateString()
  const todayObj = parseDateParam(today)

  const [summary, alerts, openTabs, , topItems, gallaBalance] = await Promise.all([
    getSalesSummary({ from: today, to: today }).catch(() => null),
    listActiveAlerts(10).catch(() => []),
    prisma.bill.count({ where: { status: "TAB_OPEN" } }).catch(() => 0),
    prisma.clearanceBatch.count({ where: { status: "ACTIVE" } }).catch(() => 0),
    getTopSellingItems(5).catch(() => []),
    prisma.$transaction(async (tx) => {
      const day = await getOrCreateGallaDay(tx as unknown as PrismaTransactionClient, todayObj)
      return computeGallaBalance(tx as unknown as PrismaTransactionClient, day.id)
    }).catch(() => null),
  ])

  const stats = [
    { label: "Today's Bills", value: String(summary?.billCount ?? 0), icon: ShoppingBag, trend: "+12%" },
    { label: "Today's Revenue", value: summary ? `₹${Number(summary.ownerRevenue).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : "₹0.00", icon: TrendingUp, trend: "+8%" },
    { label: "Cash Register", value: gallaBalance ? `₹${Number(gallaBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : "₹0.00", icon: Vault },
    { label: "Open Tabs", value: String(openTabs), icon: CreditCard, color: openTabs > 0 ? "text-amber-500" : "text-slate-400" },
  ]

  return (
    <main className="min-h-screen bg-[#f8fafc] p-4 lg:p-6">
      <header className="mb-5 flex items-center justify-between border-b-2 border-slate-100 pb-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Operations Console</h1>
          <p className="mt-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live Session Active • {today}
          </p>
        </div>
        <div className="flex gap-3">
           <Link href="/pos" className="flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-white transition-all shadow-lg shadow-slate-900/20 hover:scale-105 active:scale-95">
              <ShoppingBag size={15} />
              Open Terminal
           </Link>
        </div>
      </header>

      {/* Primary Stats Grid */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="group relative rounded-xl border-2 border-slate-100 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-slate-300">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">{stat.label}</p>
                <p className={`mt-1.5 text-2xl font-black tracking-tighter ${stat.color || "text-slate-900"}`}>{stat.value}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-2 text-slate-400 group-hover:text-slate-900 group-hover:bg-slate-100 transition-colors">
                <stat.icon size={18} />
              </div>
            </div>
            {stat.trend && (
              <div className="mt-3 flex items-center gap-1 text-[10px] font-bold text-emerald-600">
                <TrendingUp size={11} />
                {stat.trend} <span className="font-medium text-slate-400">vs yesterday</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Left Column: Analytics */}
        <div className="space-y-5 lg:col-span-2">
          {/* Top Selling Items */}
          <section className="rounded-2xl border-2 border-slate-50 bg-white shadow-sm">
            <div className="flex items-center justify-between px-5 py-3">
              <h2 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                <BarChart3 size={15} className="text-slate-400" />
                Performance Leaderboard
              </h2>
              <Link href="/reports" className="text-[9px] font-black uppercase tracking-widest text-indigo-600 hover:text-indigo-700 transition-colors">Analytical Audit</Link>
            </div>
            <div className="overflow-hidden border-t-2 border-slate-50">
              <table className="w-full text-left">
                <thead className="bg-slate-100/50 text-[9px] font-black uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Article Profile</th>
                    <th className="px-5 py-3">Classification</th>
                    <th className="px-5 py-3 text-right">Units Sold</th>
                    <th className="px-5 py-3 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-slate-50">
                  {topItems.length > 0 ? topItems.map((item, i) => (
                    <tr key={i} className="group hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3">
                        <p className="text-sm font-bold text-slate-900 tracking-tight">
                          {item.productSize
                            ? `${item.productSize.product.name} ${item.productSize.sizeMl}ml`
                            : "Unknown"}
                        </p>
                      </td>
                      <td className="px-5 py-3">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-black text-slate-500 uppercase">{item.productSize?.product.category}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className="text-sm font-bold text-slate-600 tabular-nums">{item.totalQuantity}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className="text-sm font-bold text-slate-900 tabular-nums">₹{item.totalRevenue.toFixed(2)}</span>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={4} className="px-5 py-10 text-center text-slate-400 text-[10px] font-black uppercase tracking-widest">No data yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Quick Actions Grid */}
          <section>
            <h2 className="mb-3 text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Quick Access</h2>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {[
                { href: "/cash/close", label: "Cash Close", icon: CreditCard, color: "text-emerald-500" },
                { href: "/ledger", label: "Financials", icon: BarChart3, color: "text-indigo-500" },
                { href: "/indents", label: "Procurement", icon: Package, color: "text-amber-500" },
                { href: "/inventory", label: "Stock", icon: Package, color: "text-slate-400" },
                { href: "/expenses", label: "Log Costs", icon: TrendingUp, color: "text-rose-500" },
                { href: "/reports", label: "Reports", icon: BarChart3, color: "text-indigo-400" },
              ].map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="group flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-slate-100 bg-white py-5 transition-all hover:-translate-y-0.5 hover:border-slate-900 hover:shadow-md"
                >
                  <div className={`p-2 rounded-xl bg-slate-50 group-hover:bg-white group-hover:shadow-inner transition-all ${link.color}`}>
                    <link.icon size={20} />
                  </div>
                  <span className="text-[9px] font-black text-slate-900 uppercase tracking-widest text-center">{link.label}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>

        {/* Right Column: Alerts & Status */}
        <div className="space-y-5">
          {/* Revenue Breakdown */}
          <section className="rounded-2xl border-2 border-slate-900 bg-slate-900 p-5 shadow-xl text-white">
            <h2 className="mb-4 text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Net Revenue Distribution</h2>
            <div className="space-y-3">
              {summary && Object.entries(summary.byMode).length > 0 ? (
                <>
                  {Object.entries(summary.byMode).map(([mode, amount]) => (
                    <div key={mode} className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{mode}</span>
                      <span className="text-sm font-black tabular-nums">₹{Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  ))}
                  <div className="pt-2 space-y-2">
                    <div className="flex items-center justify-between bg-emerald-500/10 -mx-2 px-3 py-3 rounded-xl">
                      <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Owner Settlement</span>
                      <span className="text-lg font-black text-emerald-400 tabular-nums">₹{Number(summary.ownerRevenue).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                    {Number(summary.thirdPartyTotal) > 0 && (
                      <div className="flex items-center justify-between px-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">Third-Party</span>
                        <span className="text-sm font-black text-amber-400 tabular-nums">₹{Number(summary.thirdPartyTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-center text-[9px] font-black uppercase tracking-widest text-slate-600 py-6">No data yet</p>
              )}
            </div>
          </section>

          {/* Critical Alerts */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">
                Operational Alerts
              </h2>
            </div>
            <div className="space-y-2">
              {alerts.length > 0 ? alerts.map((alert) => (
                <div key={alert.id} className={`flex items-start gap-3 rounded-xl border p-3 transition ${
                  alert.severity === "CRITICAL" ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"
                }`}>
                  <AlertTriangle size={15} className={`shrink-0 mt-0.5 ${alert.severity === "CRITICAL" ? "text-red-600" : "text-slate-900"}`} />
                  <div>
                    <p className={`text-xs font-bold ${alert.severity === "CRITICAL" ? "text-red-900" : "text-slate-900"}`}>{alert.title}</p>
                    <p className={`mt-0.5 text-[10px] font-medium leading-relaxed ${alert.severity === "CRITICAL" ? "text-red-700" : "text-slate-500"}`}>{alert.body}</p>
                  </div>
                </div>
              )) : (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 py-8 text-center">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Normal Operations</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
