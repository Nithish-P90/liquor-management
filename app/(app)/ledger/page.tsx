"use client"
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useCallback, useEffect, useState, useMemo } from "react"
import { BarChart3, Calendar, Download, Receipt, TrendingUp, Users, Package, AlertCircle, FileText, ArrowUpRight, Activity, Vault, ChevronDown } from "lucide-react"

type View = "overview" | "bills" | "voids" | "expenses" | "top-sellers" | "clerks" | "audit"

function today(): string { return new Date().toISOString().slice(0, 10) }
function yesterday(): string {
  const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10)
}
function sevenDaysAgo(): string {
  const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10)
}
function firstOfMonth(): string {
  const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10)
}

function fmt(v: string | number): string {
  return "₹" + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function generateDateRange(start: string, end: string): string[] {
  const arr = []
  const current = new Date(start)
  const last = new Date(end)
  // Prevent infinite loop if dates are backwards
  if (current > last) return []
  
  while (current <= last) {
    arr.push(current.toISOString().slice(0, 10))
    current.setDate(current.getDate() + 1)
  }
  // Return in descending order (newest first)
  return arr.reverse()
}

export default function LedgerPage(): JSX.Element {
  const [from, setFrom] = useState(sevenDaysAgo())
  const [to, setTo] = useState(today())

  const presets = [
    { label: "Today", onClick: () => { setFrom(today()); setTo(today()) } },
    { label: "Yesterday", onClick: () => { setFrom(yesterday()); setTo(yesterday()) } },
    { label: "Last 7 Days", onClick: () => { setFrom(sevenDaysAgo()); setTo(today()) } },
    { label: "This Month", onClick: () => { setFrom(firstOfMonth()); setTo(today()) } },
  ]

  const days = useMemo(() => generateDateRange(from, to), [from, to])

  return (
    <main className="min-h-screen bg-[#f8fafc] p-6 lg:p-5">
      <header className="mb-5 flex flex-col md:flex-row md:items-end justify-between gap-4 border-b-2 border-slate-100 pb-10">
        <div>
          <h1 className="text-xl font-black tracking-tight text-slate-900 flex items-center gap-4">
            <div className="rounded-2xl bg-slate-900 p-3 text-white shadow-xl shadow-slate-900/10">
              <BarChart3 size={32} />
            </div>
            Daily Ledger
          </h1>
          <p className="mt-3 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] px-1">
            
          </p>
        </div>

        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            {presets.map(p => (
              <button key={p.label} onClick={p.onClick} className="text-[10px] font-black uppercase tracking-widest text-slate-500 bg-white border-2 border-slate-100 hover:border-indigo-400 hover:text-indigo-600 rounded-xl px-4 py-2 transition-all shadow-sm active:scale-95">
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 bg-white border-2 border-slate-100 p-3 rounded-2xl shadow-md">
            <div className="flex items-center gap-3 pl-3">
              <Calendar size={18} className="text-slate-400" />
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="bg-transparent text-base font-black text-slate-800 focus:outline-none" />
            </div>
            <div className="h-6 w-px bg-slate-200 mx-1" />
            <div className="flex items-center gap-3">
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="bg-transparent text-base font-black text-slate-800 focus:outline-none" />
            </div>
            <a
              href={`/api/ledger?from=${from}&to=${to}&view=summary&format=csv`}
              className="ml-4 flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-slate-800 transition-all shadow-lg active:scale-95"
            >
              <Download size={14} /> Export
            </a>
          </div>
        </div>
      </header>

      <div className="space-y-6">
        {days.length > 0 ? (
          days.map(day => <DailyAccordion key={day} date={day} />)
        ) : (
          <div className="flex flex-col h-48 items-center justify-center rounded-xl border-4 border-slate-100 border-dashed text-slate-400 gap-3">
            <AlertCircle size={32} />
            <p className="text-sm font-black uppercase tracking-widest">No transaction data for this range</p>
          </div>
        )}
      </div>
    </main>
  )
}

function DailyAccordion({ date }: { date: string }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [view, setView] = useState<View>("overview")
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [hasFetchedOnce, setHasFetchedOnce] = useState(false)

  const fetch_ = useCallback(async (v: View, d: string) => {
    setLoading(true)
    try {
      if (v === "overview") {
        const [summary, sellers, expenses, clerks, bills] = await Promise.all([
          fetch(`/api/ledger?from=${d}&to=${d}&view=summary`).then(r => r.json()),
          fetch(`/api/ledger?from=${d}&to=${d}&view=top-sellers&limit=5`).then(r => r.json()),
          fetch(`/api/ledger?from=${d}&to=${d}&view=expenses&limit=5`).then(r => r.json()),
          fetch(`/api/ledger?from=${d}&to=${d}&view=clerks`).then(r => r.json()),
          fetch(`/api/ledger?from=${d}&to=${d}&view=bills&limit=5`).then(r => r.json()),
        ])
        setData({ summary, sellers, expenses, clerks, bills })
      } else {
        const res = await fetch(`/api/ledger?from=${d}&to=${d}&view=${v}`)
        setData(await res.json())
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
      setHasFetchedOnce(true)
    }
  }, [])

  useEffect(() => {
    if (isExpanded) {
      setData(null)
      fetch_(view, date)
    }
  }, [isExpanded, view, date, fetch_])

  const formattedDate = new Date(date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  // Summary preview stats available from the overview fetch.
  // Initially we won't have them, but once fetched, we can display them even when collapsed.
  const summary = data?.summary || (data?.billCount !== undefined ? data : null)

  return (
    <div className={`rounded-xl border-2 transition-all duration-300 ${isExpanded ? 'border-slate-900 shadow-2xl bg-white scale-[1.01] z-10' : 'border-slate-100 shadow-sm bg-white hover:border-indigo-200'}`}>
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex flex-col md:flex-row items-start md:items-center justify-between p-4 focus:outline-none"
      >
        <div className="flex items-center gap-6">
          <div className={`p-4 rounded-2xl transition-all duration-500 shadow-inner ${isExpanded ? 'bg-indigo-600 text-white rotate-12 scale-110' : 'bg-slate-50 text-slate-400'}`}>
            <Calendar size={28} />
          </div>
          <div className="text-left">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">{formattedDate}</h2>
            <p className="text-[11px] font-black uppercase tracking-[0.15em] text-slate-400 mt-1.5">{date}</p>
          </div>
        </div>

        <div className="flex items-center gap-5 mt-6 md:mt-0">
          {!isExpanded && !hasFetchedOnce && (
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300 animate-pulse">Load Audit Data</span>
          )}
          {summary && !isExpanded && (
            <div className="flex gap-4">
              <div className="text-right">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bills</p>
                <p className="text-lg font-black text-slate-900">{summary.billCount}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Revenue</p>
                <p className="text-lg font-black text-emerald-600">{fmt(summary.netCollectible || 0)}</p>
              </div>
            </div>
          )}
          <div className={`rounded-full p-2 transition-transform duration-500 ${isExpanded ? 'rotate-180 bg-slate-900 text-white' : 'bg-slate-50 text-slate-400'}`}>
            <ChevronDown size={24} />
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="p-4 pt-0 border-t-2 border-slate-50 mt-2">
          <div className="mt-4 mb-5 flex flex-wrap gap-3">
            {[
              { key: "overview", label: "Executive Summary", icon: BarChart3 },
              { key: "bills", label: "Transaction Feed", icon: Receipt },
              { key: "voids", label: "Void Log", icon: AlertCircle },
              { key: "expenses", label: "Payouts", icon: TrendingUp },
              { key: "top-sellers", label: "Product Performance", icon: Package },
              { key: "clerks", label: "Operator Audit", icon: Users },
              { key: "audit", label: "System Trail", icon: FileText },
            ].map((v) => (
              <button
                key={v.key}
                onClick={() => setView(v.key as View)}
                className={`flex items-center gap-2 rounded-2xl px-6 py-3.5 text-[11px] font-black uppercase tracking-widest transition-all shadow-md active:scale-95 ${
                  view === v.key 
                    ? "bg-slate-900 text-white shadow-slate-900/20" 
                    : "bg-white text-slate-500 border-2 border-slate-50 hover:border-indigo-300 hover:text-indigo-600"
                }`}
              >
                <v.icon size={16} />
                {v.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 border-dashed">
              <div className="flex flex-col items-center gap-3 text-slate-400">
                <Activity className="animate-pulse" size={32} />
                <p className="text-sm font-bold uppercase tracking-widest">Loading Report...</p>
              </div>
            </div>
          ) : (
            <LedgerView view={view} data={data} />
          )}
        </div>
      )}
    </div>
  )
}

type Row = any

function LedgerView({ view, data }: { view: View; data: any }): JSX.Element {
  if (!data) return <div className="h-64 rounded-2xl border border-slate-200 bg-slate-50"></div>

  if (view === "overview") {
    const { summary, sellers, expenses, clerks, bills } = data
    if (!summary) return <div>No data for this period.</div>

    return (
      <div className="space-y-5 animate-in fade-in zoom-in-95 duration-500">
        {/* Key Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard title="Transactions" value={summary.billCount} icon={Receipt} color="text-slate-900" bg="bg-white" accent="indigo" />
          <MetricCard title="Gross Receipts" value={fmt(summary.grossTotal)} icon={TrendingUp} color="text-slate-900" bg="bg-white" accent="emerald" />
          <MetricCard title="Total Payouts" value={fmt(expenses?.total ?? 0)} icon={ArrowUpRight} color="text-rose-600" bg="bg-rose-50/30" accent="red" />
          <MetricCard title="Net Settlement" value={fmt(summary.netCollectible)} icon={Vault} color="text-emerald-700" bg="bg-emerald-50/50" accent="emerald" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Revenue Breakdown & Clerks */}
          <div className="lg:col-span-1 space-y-5">
            <div className="rounded-xl border-2 border-slate-50 bg-white p-4 shadow-sm">
              <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 mb-4 px-1">Revenue Segmentation</h3>
              <div className="space-y-5">
                {summary.byMode && Object.entries(summary.byMode).map(([mode, amount]) => (
                  <div key={mode} className="flex justify-between items-center pb-4 border-b-2 border-slate-50">
                    <span className="text-sm font-black text-slate-600 uppercase tracking-tight">{mode}</span>
                    <span className="text-base font-black text-slate-900">{fmt(amount as string)}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center pb-4 border-b-2 border-slate-50">
                  <span className="text-sm font-black text-slate-600 uppercase tracking-tight">Third-Party Share</span>
                  <span className="text-base font-black text-amber-600">{fmt(summary.thirdPartyTotal)}</span>
                </div>
                <div className="flex justify-between items-center pt-4 bg-emerald-50/50 -mx-4 px-4 rounded-2xl">
                  <span className="text-sm font-black text-emerald-800 uppercase tracking-widest">Collectible Cash</span>
                  <span className="text-2xl font-black text-emerald-600 tracking-tight">{fmt(summary.netCollectible)}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border-2 border-slate-50 bg-white p-4 shadow-sm">
              <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 mb-4 flex items-center gap-2"><Users size={16}/> Operator Efficiency</h3>
              <div className="space-y-6">
                {clerks?.length > 0 ? clerks.map((c: Row, i: number) => (
                  <div key={i} className="flex justify-between items-center group">
                    <div className="flex flex-col">
                      <span className="text-sm font-black text-slate-800 tracking-tight">{c.clerkId ? `OPERATOR #${c.clerkId}` : "MASTER COUNTER"}</span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">{c._count.id} DISPATCHES</span>
                    </div>
                    <span className="text-lg font-black text-emerald-600 tabular-nums">{fmt(c._sum.netCollectible)}</span>
                  </div>
                )) : <div className="text-center py-3 text-[11px] font-black uppercase tracking-widest text-slate-300">No Operator Data</div>}
              </div>
            </div>
          </div>

          {/* Main Feed: Top Sellers, Expenses, Recent Bills */}
          <div className="lg:col-span-2 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm overflow-hidden flex flex-col h-[300px]">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2"><Package size={16}/> Top Sellers</h3>
                <div className="overflow-y-auto flex-1 no-scrollbar pr-2">
                  {sellers?.length > 0 ? sellers.map((s: Row, i: number) => (
                    <div key={i} className="flex justify-between items-center mb-4 last:mb-0">
                      <div>
                        <p className="text-sm font-bold text-slate-800 line-clamp-1">{s.productSize?.product.name ?? "Unknown"}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{s.productSize?.sizeMl}ml • {s.totalQty} Units</p>
                      </div>
                      <span className="text-sm font-black text-emerald-600 whitespace-nowrap">{fmt(s.totalRevenue)}</span>
                    </div>
                  )) : <p className="text-xs font-medium text-slate-400 text-center py-4">No sales</p>}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm overflow-hidden flex flex-col h-[300px]">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2"><TrendingUp size={16}/> Top Expenses</h3>
                <div className="overflow-y-auto flex-1 no-scrollbar pr-2">
                  {expenses?.expenses?.length > 0 ? expenses.expenses.map((e: Row) => (
                    <div key={e.id} className="flex justify-between items-center mb-4 last:mb-0">
                      <div>
                        <p className="text-sm font-bold text-slate-800 line-clamp-1">{e.particulars}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{e.categoryRef?.name ?? e.category}</p>
                      </div>
                      <span className="text-sm font-black text-red-500 whitespace-nowrap">{fmt(e.amount)}</span>
                    </div>
                  )) : <p className="text-xs font-medium text-slate-400 text-center py-4">No expenses</p>}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
               <div className="p-6 border-b border-slate-100">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2"><Receipt size={16}/> Recent Transactions</h3>
               </div>
               <div className="overflow-x-auto">
                 <table className="w-full text-left">
                   <thead className="bg-slate-50/50 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100">
                     <tr>
                       <th className="px-6 py-4">Time</th>
                       <th className="px-6 py-4">Bill No</th>
                       <th className="px-6 py-4">Items</th>
                       <th className="px-6 py-4 text-right">Amount</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100">
                     {bills?.map((b: Row) => (
                       <tr key={b.id} className="hover:bg-slate-50/50 transition-colors">
                         <td className="px-6 py-4 text-xs font-bold text-slate-500">{new Date(b.billedAt).toLocaleTimeString("en-IN", {hour: '2-digit', minute:'2-digit'})}</td>
                         <td className="px-6 py-4 text-sm font-mono font-bold text-slate-800">{b.billNumber}</td>
                         <td className="px-6 py-4 text-sm font-medium text-slate-600">{b.lines?.length || 0} lines</td>
                         <td className="px-6 py-4 text-right text-sm font-black text-emerald-600">{fmt(b.netCollectible)}</td>
                       </tr>
                     ))}
                     {!bills?.length && (
                       <tr><td colSpan={4} className="px-6 py-3 text-center text-xs font-medium text-slate-400">No recent transactions</td></tr>
                     )}
                   </tbody>
                 </table>
               </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // --- Detailed Views ---

  if (view === "bills") {
    return (
      <DataTable 
        headers={["Bill No", "Time", "Operator", "Items", "Amount"]}
        data={data}
        renderRow={(b) => (
          <tr key={b.id} className="hover:bg-slate-50/50 transition-colors">
            <td className="px-6 py-4 text-sm font-mono font-bold text-slate-800">{b.billNumber}</td>
            <td className="px-6 py-4 text-xs font-bold text-slate-500">{new Date(b.billedAt).toLocaleString("en-IN")}</td>
            <td className="px-6 py-4 text-sm font-bold text-slate-700">{b.operator?.name}</td>
            <td className="px-6 py-4 text-sm font-medium text-slate-600">{b.lines?.length || 0} lines</td>
            <td className="px-6 py-4 text-right text-sm font-black text-emerald-600">{fmt(b.netCollectible)}</td>
          </tr>
        )}
      />
    )
  }

  if (view === "top-sellers") {
    return (
      <DataTable 
        headers={["Product", "Category", "Qty Sold", "Revenue"]}
        data={data}
        renderRow={(s, i) => (
          <tr key={i} className="hover:bg-slate-50/50 transition-colors">
            <td className="px-6 py-4">
              <p className="text-sm font-bold text-slate-800">{s.productSize?.product.name ?? "Unknown"}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{s.productSize?.sizeMl}ml</p>
            </td>
            <td className="px-6 py-4 text-xs font-bold text-slate-500">{s.productSize?.product.category ?? "MISC"}</td>
            <td className="px-6 py-4 text-sm font-black text-slate-700">{s.totalQty}</td>
            <td className="px-6 py-4 text-right text-sm font-black text-emerald-600">{fmt(s.totalRevenue)}</td>
          </tr>
        )}
      />
    )
  }

  if (view === "expenses") {
    return (
      <div className="space-y-6">
        <div className="inline-block rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-red-400 mb-1">Total Expenses</p>
          <p className="text-lg font-black text-red-600">{fmt(data.total)}</p>
        </div>
        <DataTable
          headers={["Date", "Particulars", "Category", "Amount"]}
          data={data.expenses}
          renderRow={(e) => (
            <tr key={e.id} className="hover:bg-slate-50/50 transition-colors">
              <td className="px-6 py-4 text-xs font-bold text-slate-500">{e.expDate.slice(0, 10)}</td>
              <td className="px-6 py-4 text-sm font-bold text-slate-800">{e.particulars}</td>
              <td className="px-6 py-4 text-xs font-bold text-slate-500 bg-slate-100 rounded-md inline-flex items-center justify-center px-2 py-1 mt-3 ml-6">{e.categoryRef?.name ?? e.category}</td>
              <td className="px-6 py-4 text-right text-sm font-black text-red-500">{fmt(e.amount)}</td>
            </tr>
          )}
        />
      </div>
    )
  }

  if (view === "audit") {
    return (
      <DataTable 
        headers={["Time", "Actor", "Event", "Entity", "Reason"]}
        data={data}
        renderRow={(e) => (
          <tr key={String(e.id)} className="hover:bg-slate-50/50 transition-colors">
            <td className="px-6 py-4 text-xs font-bold text-slate-500 whitespace-nowrap">{new Date(e.occurredAt).toLocaleString("en-IN")}</td>
            <td className="px-6 py-4 text-sm font-bold text-slate-800 whitespace-nowrap">{e.actor?.name ?? "System"}</td>
            <td className="px-6 py-4"><span className="bg-indigo-50 text-indigo-700 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md">{e.eventType}</span></td>
            <td className="px-6 py-4 text-sm font-mono text-slate-500">{e.entity}#{e.entityId}</td>
            <td className="px-6 py-4 text-xs font-medium text-slate-600 line-clamp-2">{e.reason ?? "—"}</td>
          </tr>
        )}
      />
    )
  }

  if (view === "voids") {
    return (
      <DataTable 
        headers={["Bill No", "Operator", "Voided By", "Reason", "Amount"]}
        data={data}
        renderRow={(b) => (
          <tr key={b.id} className="hover:bg-slate-50/50 transition-colors">
            <td className="px-6 py-4 text-sm font-mono font-bold text-slate-800">{b.billNumber}</td>
            <td className="px-6 py-4 text-sm font-bold text-slate-700">{b.operator?.name}</td>
            <td className="px-6 py-4 text-sm font-bold text-slate-700">{b.voidedBy?.name ?? "—"}</td>
            <td className="px-6 py-4 text-xs font-medium text-slate-500">{b.voidReason ?? "—"}</td>
            <td className="px-6 py-4 text-right text-sm font-black text-red-500">{fmt(b.netCollectible)}</td>
          </tr>
        )}
      />
    )
  }

  if (view === "clerks") {
    return (
      <DataTable 
        headers={["Clerk", "Bills Handled", "Net Revenue"]}
        data={data}
        renderRow={(c, i) => (
          <tr key={i} className="hover:bg-slate-50/50 transition-colors">
            <td className="px-6 py-4 text-sm font-bold text-slate-800">{c.clerkId ? `Clerk #${c.clerkId}` : "Counter"}</td>
            <td className="px-6 py-4 text-sm font-black text-slate-700">{c._count.id}</td>
            <td className="px-6 py-4 text-right text-sm font-black text-emerald-600">{fmt(c._sum.netCollectible ?? 0)}</td>
          </tr>
        )}
      />
    )
  }

  return <pre className="text-xs text-slate-400 overflow-auto bg-white p-6 rounded-2xl border border-slate-200">{JSON.stringify(data, null, 2)}</pre>
}

function MetricCard({ title, value, icon: Icon, color = "text-slate-900", bg = "bg-white", accent = "slate" }: { title: string, value: string | number, icon: any, color?: string, bg?: string, accent?: string }) {
  const accentMap = {
    emerald: "text-emerald-500",
    indigo: "text-indigo-500",
    red: "text-rose-500",
    slate: "text-slate-400",
  }
  const accentColor = accentMap[accent as keyof typeof accentMap] || "text-slate-400"

  return (
    <div className={`rounded-xl border-2 border-slate-50 ${bg} p-4 shadow-sm flex flex-col justify-between h-40 transition-all hover:shadow-xl hover:-translate-y-1`}>
      <div className="flex justify-between items-start">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{title}</p>
        <div className={`p-2.5 rounded-2xl bg-slate-50 ${accentColor} shadow-inner`}>
          <Icon size={20} />
        </div>
      </div>
      <p className={`text-lg font-black tracking-tight tabular-nums ${color}`}>{value}</p>
    </div>
  )
}

function DataTable({ headers, data, renderRow }: { headers: string[], data: any[], renderRow: (item: any, index: number) => JSX.Element }) {
  return (
    <div className="rounded-xl border-2 border-slate-50 bg-white overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left whitespace-nowrap">
          <thead className="bg-slate-100/50 text-[11px] font-black uppercase tracking-widest text-slate-500 border-b-2 border-slate-50">
            <tr>
              {headers.map((h, i) => (
                <th key={i} className={`px-6 py-5 ${i === headers.length - 1 ? 'text-right' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-slate-50">
            {data?.length > 0 ? data.map(renderRow) : (
              <tr><td colSpan={headers.length} className="px-6 py-5 text-center text-xs font-medium text-slate-400">No records found for the selected period.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
