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
    <main className="min-h-screen bg-[#f8fafc] p-6 lg:p-10">
      <header className="mb-12 flex items-center justify-between border-b-2 border-slate-100 pb-10">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-slate-900">Operations Console</h1>
          <p className="mt-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Live Session Active • {today}
          </p>
        </div>
        <div className="flex gap-4">
           <Link href="/pos" className="flex items-center gap-3 rounded-2xl bg-slate-900 px-8 py-4 text-[11px] font-black uppercase tracking-widest text-white transition-all shadow-xl shadow-slate-900/20 hover:scale-105 active:scale-95">
              <ShoppingBag size={18} />
              Open Terminal
           </Link>
        </div>
      </header>

      {/* Primary Stats Grid */}
      <div className="mb-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="group relative rounded-2xl border-2 border-slate-100 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg hover:border-slate-300">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.15em] text-slate-400">{stat.label}</p>
                <p className={`mt-2 text-4xl font-black tracking-tighter ${stat.color || "text-slate-900"}`}>{stat.value}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-slate-400 group-hover:text-slate-900 group-hover:bg-slate-100 transition-colors">
                <stat.icon size={24} />
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
          <section className="rounded-3xl border-2 border-slate-50 bg-white p-2 shadow-sm">
            <div className="flex items-center justify-between p-6 px-8">
              <h2 className="flex items-center gap-3 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                <BarChart3 size={18} className="text-slate-400" />
                Performance Leaderboard
              </h2>
              <Link href="/reports" className="text-[10px] font-black uppercase tracking-widest text-indigo-600 hover:text-indigo-700 transition-colors">Analytical Audit</Link>
            </div>
            <div className="overflow-hidden border-t-2 border-slate-50 rounded-b-3xl">
              <table className="w-full text-left">
                <thead className="bg-slate-100/50 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="px-8 py-5">Article Profile</th>
                    <th className="px-8 py-5">Classification</th>
                    <th className="px-8 py-5 text-right">Units Sold</th>
                    <th className="px-8 py-5 text-right">MAGNITUDE</th>
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-slate-50">
                  {topItems.length > 0 ? topItems.map((item, i) => (
                    <tr key={i} className="group hover:bg-slate-50 transition-colors">
                      <td className="px-8 py-5">
                        <p className="text-base font-black text-slate-900 tracking-tight">
                          {item.productSize
                            ? `${item.productSize.product.name} ${item.productSize.sizeMl}ml`
                            : "Unknown"}
                        </p>
                      </td>
                      <td className="px-8 py-5">
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[9px] font-black text-slate-500 uppercase">{item.productSize?.product.category}</span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <span className="text-base font-black text-slate-600 tabular-nums">{item.totalQuantity}</span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <span className="text-lg font-black text-slate-900 tabular-nums">₹{item.totalRevenue.toFixed(2)}</span>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={4} className="px-8 py-16 text-center text-slate-400 text-[10px] font-black uppercase tracking-widest">Nil performance metrics</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Quick Actions Grid */}
          <section>
            <h2 className="mb-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 text-center">System Management Architecture</h2>
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
              {[
                { href: "/cash/close", label: "Cash Close", icon: CreditCard, color: "text-emerald-500" },
                { href: "/ledger", label: "Financials", icon: BarChart3, color: "text-indigo-500" },
                { href: "/indents", label: "Inventory Opt", icon: Package, color: "text-amber-500" },
                { href: "/inventory", label: "Stock Control", icon: Package, color: "text-slate-400" },
                { href: "/expenses", label: "Log Costs", icon: TrendingUp, color: "text-rose-500" },
                { href: "/reports", label: "Operations", icon: BarChart3, color: "text-indigo-400" },
              ].map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="group flex flex-col items-center justify-center gap-6 rounded-[2.5rem] border-2 border-slate-100 bg-white py-10 transition-all hover:-translate-y-1 hover:border-slate-900 hover:shadow-xl"
                >
                  <div className={`p-4 rounded-2xl bg-slate-50 group-hover:bg-white group-hover:shadow-inner transition-all ${link.color}`}>
                    <link.icon size={32} />
                  </div>
                  <span className="text-[11px] font-black text-slate-900 uppercase tracking-widest">{link.label}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>

        {/* Right Column: Alerts & Status */}
        <div className="space-y-10">
          {/* Revenue Breakdown */}
          <section className="rounded-[2.5rem] border-2 border-slate-900 bg-slate-900 p-8 shadow-2xl text-white">
            <h2 className="mb-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Net Revenue Distribution</h2>
            <div className="space-y-6">
              {summary && Object.entries(summary.byMode).length > 0 ? (
                <>
                  {Object.entries(summary.byMode).map(([mode, amount]) => (
                    <div key={mode} className="flex items-center justify-between border-b border-slate-800 pb-5">
                      <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">{mode}</span>
                      <span className="text-base font-black tabular-nums">₹{Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  ))}
                  <div className="pt-4 space-y-4">
                    <div className="flex items-center justify-between bg-emerald-500/10 -mx-4 px-4 py-4 rounded-2xl">
                      <span className="text-[11px] font-black uppercase tracking-widest text-emerald-400">Owner Settlement</span>
                      <span className="text-2xl font-black text-emerald-400 tabular-nums">₹{Number(summary.ownerRevenue).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                    {Number(summary.thirdPartyTotal) > 0 && (
                      <div className="flex items-center justify-between px-4">
                        <span className="text-[11px] font-black uppercase tracking-widest text-amber-400">Third-Party Share</span>
                        <span className="text-lg font-black text-amber-400 tabular-nums">₹{Number(summary.thirdPartyTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-center text-[10px] font-black uppercase tracking-widest text-slate-600 py-8">Nil distribution data</p>
              )}
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
