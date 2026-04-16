'use client'
import { useEffect, useState, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

type DaySummary = {
  date:    string
  isLive:  boolean
  financials: {
    totalSales:       number
    totalExpenses:    number
    netCash:          number
    totalBottlesSold: number
    totalBills:       number
    salesByMode:      Record<string, number>
  }
}

type ClerkRow = {
  staffId: number; staffName: string; role: string
  bottles: number; total: number; bills: number
}

type DayDetail = {
  date:       string
  isToday:    boolean
  hasSession: boolean
  financials: DaySummary['financials']
  clerkBreakup: ClerkRow[]
  sales: Array<{
    id: number; time: string; productName: string; category: string
    sizeMl: number; qty: number; price: number; total: number
    paymentMode: string; staffName: string
  }>
  receipts: Array<{
    id: number; indentNumber: string; invoiceNumber: string
    productName: string; category: string; sizeMl: number
    cases: number; bottles: number; totalBottles: number
  }>
  expenses: Array<{ id: number; particulars: string; category: string; amount: number }>
  attendance: Array<{
    staffId: number; staffName: string; role: string
    checkIn: string | null; checkOut: string | null
    hoursWorked: number | null; status: string
    lateCheckIn: boolean; lateCheckOut: boolean
    expectedCheckIn: string | null; expectedCheckOut: string | null
  }>
  adjustments: Array<{
    id: number; productName: string; sizeMl: number; category: string
    type: string; qty: number; reason: string; approved: boolean; createdBy: string
  }>
  openingStock: Array<{
    productSizeId: number; productName: string; category: string; sizeMl: number
    cases: number; bottles: number; totalBottles: number; value: number
  }>
  closingStock: Array<{
    productSizeId: number; productName: string; category: string; sizeMl: number
    cases: number; bottles: number; totalBottles: number; value: number
    openingBottles: number; receiptsBottles: number; salesBottles: number; adjBottles: number
  }>
  closingTotal:  number
  openingTotal:  number
  cashFlow: {
    openingRegister:    number | null
    cashSales:          number | null
    expenses:           number | null
    cashToLocker:       number | null
    closingRegister:    number | null
    bankDeposits: Array<{ id: number; amount: number; notes: string | null }>
    totalBankDeposited: number
  } | null
}

// ── Formatters ─────────────────────────────────────────────────────────────────

const fmt  = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
const fmtT = (dt: string | null) =>
  dt ? new Date(dt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'
const fmtH = (h: number | null) => {
  if (h === null) return '—'
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60)
  return `${hh}h ${mm}m`
}
function fmtDate(d: string) {
  const dt = new Date(d)
  const day   = String(dt.getUTCDate()).padStart(2, '0')
  const month = dt.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' })
  const year  = dt.getUTCFullYear()
  const weekday = dt.toLocaleString('en-IN', { weekday: 'short', timeZone: 'UTC' })
  return { day, month, year, weekday, full: `${day} ${month} ${year}` }
}
function toDateParam(d: string) {
  const dt = new Date(d)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

// ── Tabs ───────────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'summary',    label: 'Summary'       },
  { key: 'clerks',     label: 'Clerk Breakup' },
  { key: 'sales',      label: 'Sales'         },
  { key: 'expenses',   label: 'Expenses'      },
  { key: 'cash',       label: 'Cash Tally'    },
  { key: 'attendance', label: 'Attendance'    },
  { key: 'stock',      label: 'Stock'         },
] as const
type TabKey = typeof TABS[number]['key']

// ── Main page ──────────────────────────────────────────────────────────────────

export default function DailyLedgerPage() {
  const [summaries,     setSummaries]     = useState<DaySummary[]>([])
  const [expanded,      setExpanded]      = useState<string | null>(null)
  const [activeTab,     setActiveTab]     = useState<TabKey>('summary')
  const [detailCache,   setDetailCache]   = useState<Record<string, DayDetail>>({})
  const [loadingList,   setLoadingList]   = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const loadList = useCallback(async () => {
    try {
      const data = await fetch('/api/reports/daily').then(r => r.json())
      const arr  = Array.isArray(data) ? data : []
      setSummaries(arr)
      // Auto-expand today
      if (arr.length > 0 && expanded === null) {
        setExpanded(new Date(arr[0].date).toISOString())
        loadDetailForDate(arr[0].date)
      }
    } finally {
      setLoadingList(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { loadList() }, [loadList])
  useEffect(() => {
    const id = setInterval(loadList, 60_000)
    return () => clearInterval(id)
  }, [loadList])

  async function loadDetailForDate(dateStr: string) {
    const key = new Date(dateStr).toISOString()
    if (detailCache[key]) return
    setLoadingDetail(true)
    try {
      const param = toDateParam(dateStr)
      const data  = await fetch(`/api/reports/daily/detail?date=${param}`).then(r => r.json())
      setDetailCache(prev => ({ ...prev, [key]: data }))
    } finally {
      setLoadingDetail(false)
    }
  }

  function toggleExpand(dateStr: string) {
    const key = new Date(dateStr).toISOString()
    if (expanded === key) {
      setExpanded(null)
    } else {
      setExpanded(key)
      setActiveTab('summary')
      loadDetailForDate(dateStr)
    }
  }

  // Live refresh for today's detail
  useEffect(() => {
    if (!expanded) return
    const summary = summaries.find(s => new Date(s.date).toISOString() === expanded)
    if (!summary?.isLive) return
    const id = setInterval(async () => {
      const param = toDateParam(summary.date)
      const data  = await fetch(`/api/reports/daily/detail?date=${param}`).then(r => r.json())
      setDetailCache(prev => ({ ...prev, [expanded]: data }))
    }, 60_000)
    return () => clearInterval(id)
  }, [expanded, summaries])

  if (loadingList) return (
    <div className="p-8 flex items-center justify-center min-h-64">
      <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="p-4 lg:p-6 space-y-3 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Daily Ledger</h1>
        <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1.5 rounded-lg">
          {summaries.length} days recorded
        </span>
      </div>

      {summaries.length === 0 && (
        <div className="text-center py-16 bg-white border border-gray-200 rounded-xl text-gray-400">
          <div className="text-4xl mb-3">📋</div>
          <div className="font-semibold text-gray-500">No data yet</div>
          <div className="text-sm mt-1">Sales, expenses and attendance will appear here day by day.</div>
        </div>
      )}

      <div className="space-y-2">
        {summaries.map(s => {
          const key    = new Date(s.date).toISOString()
          const isExp  = expanded === key
          const detail = detailCache[key]
          const df     = fmtDate(s.date)

          return (
            <div key={key} className={`bg-white rounded-xl border transition-all ${
              isExp ? 'border-blue-300 shadow-md' : 'border-gray-200 hover:border-blue-200'
            }`}>
              {/* ── Row header ─────────────────────────────────────────────── */}
              <button
                onClick={() => toggleExpand(s.date)}
                className="w-full text-left px-4 py-3 flex items-center gap-4"
              >
                {/* Date block */}
                <div className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl shrink-0 ${
                  s.isLive ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                }`}>
                  <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">{df.weekday}</span>
                  <span className="text-xl font-black leading-none">{df.day}</span>
                  <span className="text-[10px] font-semibold uppercase">{df.month}</span>
                </div>

                {/* Stats */}
                <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-0.5 text-sm">
                  <div>
                    <span className="text-gray-400 text-xs">Sales</span>
                    <div className="font-bold text-gray-900">{fmt(s.financials.totalSales)}</div>
                  </div>
                  <div>
                    <span className="text-gray-400 text-xs">Expenses</span>
                    <div className="font-bold text-red-600">{fmt(s.financials.totalExpenses)}</div>
                  </div>
                  <div>
                    <span className="text-gray-400 text-xs">Net Cash</span>
                    <div className="font-bold text-emerald-600">{fmt(s.financials.netCash)}</div>
                  </div>
                  <div>
                    <span className="text-gray-400 text-xs">Bottles</span>
                    <div className="font-bold text-gray-700">{s.financials.totalBottlesSold} btls · {s.financials.totalBills} bills</div>
                  </div>
                </div>

                {/* Live badge + chevron */}
                <div className="flex items-center gap-2 shrink-0">
                  {s.isLive && (
                    <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded-full border border-emerald-200 uppercase">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live
                    </span>
                  )}
                  <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExp ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {/* ── Expanded detail ─────────────────────────────────────────── */}
              {isExp && (
                <div className="border-t border-gray-100">
                  {/* Tab bar */}
                  <div className="flex gap-0 border-b border-gray-100 bg-gray-50/60 overflow-x-auto">
                    {TABS.map(t => {
                      const count =
                        t.key === 'clerks'     ? detail?.clerkBreakup.length
                        : t.key === 'sales'    ? detail?.sales.length
                        : t.key === 'expenses' ? detail?.expenses.length
                        : t.key === 'attendance' ? detail?.attendance.filter(a => a.status !== 'ABSENT').length
                        : undefined
                      return (
                        <button key={t.key} onClick={() => setActiveTab(t.key)}
                          className={`px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${
                            activeTab === t.key
                              ? 'border-blue-600 text-blue-700 bg-white'
                              : 'border-transparent text-gray-500 hover:text-gray-800'
                          }`}
                        >
                          {t.label}
                          {count !== undefined && count > 0 && (
                            <span className="px-1.5 py-0.5 bg-gray-200 text-gray-600 text-[10px] font-bold rounded-full">
                              {count}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>

                  {/* Tab content */}
                  <div className="p-4">
                    {loadingDetail && !detail ? (
                      <div className="flex items-center justify-center h-32">
                        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : detail ? (
                      <>
                        {/* ── SUMMARY ──────────────────────────────────────── */}
                        {activeTab === 'summary' && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            {/* Sales breakdown */}
                            <div>
                              <SectionTitle>Sales Breakdown</SectionTitle>
                              <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 text-sm">
                                {[
                                  ['Cash',          detail.financials.salesByMode.CASH,   'text-green-700'],
                                  ['UPI / Digital', detail.financials.salesByMode.UPI,    'text-purple-700'],
                                  ['Card',          detail.financials.salesByMode.CARD,   'text-blue-700'],
                                  ['Credit',        detail.financials.salesByMode.CREDIT, 'text-orange-700'],
                                ].map(([label, val, cls]) => (
                                  <div key={String(label)} className="flex justify-between px-4 py-2.5">
                                    <span className="text-gray-500">{String(label)}</span>
                                    <span className={`font-semibold ${String(cls)}`}>{fmt(Number(val))}</span>
                                  </div>
                                ))}
                                <div className="flex justify-between px-4 py-2.5 font-bold bg-gray-50">
                                  <span className="text-gray-700">Total Sales</span>
                                  <span className="text-gray-900">{fmt(detail.financials.totalSales)}</span>
                                </div>
                                <div className="flex justify-between px-4 py-2.5 bg-red-50">
                                  <span className="text-red-700">− Expenses</span>
                                  <span className="text-red-700 font-bold">{fmt(detail.financials.totalExpenses)}</span>
                                </div>
                                <div className="flex justify-between px-4 py-3 bg-emerald-50 border-t border-emerald-200">
                                  <span className="text-emerald-800 font-bold">Net Cash</span>
                                  <span className="text-emerald-800 font-black">{fmt(detail.financials.netCash)}</span>
                                </div>
                              </div>
                            </div>

                            <div className="space-y-4">
                              {/* Stock at a glance */}
                              <div>
                                <SectionTitle>Stock at a Glance</SectionTitle>
                                <div className="grid grid-cols-2 gap-2">
                                  {[
                                    { label: 'Opening',  val: detail.openingTotal + ' btls', color: 'blue' },
                                    { label: 'Received', val: detail.receipts.reduce((s, r) => s + r.totalBottles, 0) + ' btls', color: 'indigo' },
                                    { label: 'Sold',     val: detail.financials.totalBottlesSold + ' btls', color: 'orange' },
                                    { label: 'Closing',  val: detail.closingTotal + ' btls', color: 'emerald' },
                                  ].map(({ label, val, color }) => (
                                    <div key={label} className={`rounded-xl p-3 bg-${color}-50 border border-${color}-100`}>
                                      <div className={`text-[10px] font-bold uppercase tracking-wider text-${color}-500`}>{label}</div>
                                      <div className={`text-lg font-black text-${color}-700 mt-0.5`}>{val}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Top clerks preview */}
                              {detail.clerkBreakup.length > 0 && (
                                <div>
                                  <SectionTitle>Top Clerks</SectionTitle>
                                  <div className="space-y-1.5">
                                    {detail.clerkBreakup.slice(0, 3).map(c => (
                                      <div key={c.staffId} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                                        <div>
                                          <span className="font-semibold text-gray-800">{c.staffName}</span>
                                          <span className="ml-2 text-xs text-gray-400">{c.role}</span>
                                        </div>
                                        <div className="text-right">
                                          <div className="font-bold text-gray-900">{fmt(c.total)}</div>
                                          <div className="text-xs text-gray-400">{c.bottles} btls</div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Attendance quick view */}
                              <div>
                                <SectionTitle>Attendance</SectionTitle>
                                <div className="flex gap-2">
                                  {[
                                    { label: 'Present', val: detail.attendance.filter(a => a.status !== 'ABSENT').length, color: 'emerald' },
                                    { label: 'Absent',  val: detail.attendance.filter(a => a.status === 'ABSENT').length,  color: 'gray'    },
                                  ].map(({ label, val, color }) => (
                                    <div key={label} className={`flex-1 rounded-xl p-3 bg-${color}-50 border border-${color}-200 text-center`}>
                                      <div className={`text-2xl font-black text-${color}-700`}>{val}</div>
                                      <div className={`text-xs font-semibold text-${color}-500`}>{label}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* ── CLERK BREAKUP ─────────────────────────────────── */}
                        {activeTab === 'clerks' && (
                          detail.clerkBreakup.length === 0
                            ? <Empty>No sales recorded for this day.</Empty>
                            : (
                              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                                <table className="w-full text-sm">
                                  <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr>
                                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Staff</th>
                                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Role</th>
                                      <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Bills</th>
                                      <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Bottles</th>
                                      <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Total Sales</th>
                                      <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Share</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-50">
                                    {detail.clerkBreakup.map(c => (
                                      <tr key={c.staffId} className="hover:bg-blue-50/20">
                                        <td className="px-4 py-3 font-semibold text-gray-900">{c.staffName}</td>
                                        <td className="px-4 py-3 text-gray-500 text-xs">
                                          <span className="px-2 py-0.5 bg-gray-100 rounded font-medium">{c.role}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right text-gray-700">{c.bills}</td>
                                        <td className="px-4 py-3 text-right text-gray-700">{c.bottles}</td>
                                        <td className="px-4 py-3 text-right font-bold text-gray-900">{fmt(c.total)}</td>
                                        <td className="px-4 py-3 text-right">
                                          <div className="flex items-center justify-end gap-2">
                                            <div className="w-16 bg-gray-100 rounded-full h-1.5">
                                              <div
                                                className="bg-blue-500 h-1.5 rounded-full"
                                                style={{ width: `${detail.financials.totalSales > 0 ? Math.round(c.total / detail.financials.totalSales * 100) : 0}%` }}
                                              />
                                            </div>
                                            <span className="text-xs text-gray-500 w-8 text-right">
                                              {detail.financials.totalSales > 0
                                                ? Math.round(c.total / detail.financials.totalSales * 100) + '%'
                                                : '0%'}
                                            </span>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr className="bg-gray-50 border-t border-gray-200 font-bold">
                                      <td className="px-4 py-2.5 text-gray-600" colSpan={2}>Total</td>
                                      <td className="px-4 py-2.5 text-right">{detail.clerkBreakup.reduce((s, c) => s + c.bills, 0)}</td>
                                      <td className="px-4 py-2.5 text-right">{detail.financials.totalBottlesSold}</td>
                                      <td className="px-4 py-2.5 text-right">{fmt(detail.financials.totalSales)}</td>
                                      <td />
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            )
                        )}

                        {/* ── SALES ────────────────────────────────────────── */}
                        {activeTab === 'sales' && (
                          <DataTable
                            empty="No sales recorded."
                            rows={detail.sales}
                            cols={[
                              { header: 'Time',    render: r => fmtT(r.time)                                                    },
                              { header: 'Product', render: r => (
                                <div>
                                  <div className="font-semibold text-gray-900">{r.productName}</div>
                                  <div className="text-xs text-gray-400">{r.category} · {r.sizeMl}ml</div>
                                </div>
                              )},
                              { header: 'Qty',     render: r => r.qty + ' btl',  align: 'right'                                },
                              { header: 'Amount',  render: r => fmt(r.total),     align: 'right'                                },
                              { header: 'Mode',    render: r => <PayBadge mode={r.paymentMode} />                               },
                              { header: 'Staff',   render: r => r.staffName                                                     },
                            ]}
                            footer={() => (
                              <tr className="bg-gray-50 border-t border-gray-200 font-bold">
                                <td className="px-4 py-2.5 text-gray-600" colSpan={2}>Total</td>
                                <td className="px-4 py-2.5 text-right">{detail.financials.totalBottlesSold} btl</td>
                                <td className="px-4 py-2.5 text-right">{fmt(detail.financials.totalSales)}</td>
                                <td colSpan={2} />
                              </tr>
                            )}
                          />
                        )}

                        {/* ── EXPENSES ─────────────────────────────────────── */}
                        {activeTab === 'expenses' && (
                          <DataTable
                            empty="No expenses recorded."
                            rows={detail.expenses}
                            cols={[
                              { header: 'Particulars', render: r => r.particulars },
                              { header: 'Category',    render: r => (
                                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-medium">
                                  {r.category}
                                </span>
                              )},
                              { header: 'Amount', render: r => fmt(r.amount), align: 'right' },
                            ]}
                            footer={() => (
                              <tr className="bg-red-50 border-t font-bold text-red-700">
                                <td className="px-4 py-2.5" colSpan={2}>Total Expenses</td>
                                <td className="px-4 py-2.5 text-right">{fmt(detail.financials.totalExpenses)}</td>
                              </tr>
                            )}
                          />
                        )}

                        {/* ── CASH TALLY ────────────────────────────────────── */}
                        {activeTab === 'cash' && (
                          <div className="max-w-lg">
                            <SectionTitle>Galla (Cash Register) Tally</SectionTitle>
                            {detail.cashFlow ? (
                              <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 text-sm">
                                {[
                                  { label: 'Opening Register',  val: detail.cashFlow.openingRegister ?? 0,  cls: 'text-gray-700' },
                                  { label: '+ Cash Sales',      val: detail.cashFlow.cashSales ?? 0,        cls: 'text-green-700' },
                                  { label: '− Expenses',        val: detail.cashFlow.expenses ?? 0,         cls: 'text-red-600'  },
                                  { label: '→ Moved to Locker', val: detail.cashFlow.cashToLocker ?? 0,     cls: 'text-amber-700' },
                                  { label: 'Closing Register',  val: detail.cashFlow.closingRegister ?? 0,  cls: 'text-gray-900 font-black' },
                                ].map(({ label, val, cls }) => (
                                  <div key={label} className="flex justify-between px-4 py-3">
                                    <span className="text-gray-500">{label}</span>
                                    <span className={cls}>{fmt(val)}</span>
                                  </div>
                                ))}
                                {detail.cashFlow.bankDeposits.map(dep => (
                                  <div key={dep.id} className="flex justify-between px-4 py-3 bg-blue-50">
                                    <span className="text-blue-700 font-medium">
                                      Bank Deposit{dep.notes ? ` — ${dep.notes}` : ''}
                                    </span>
                                    <span className="text-blue-700 font-bold">{fmt(dep.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-center py-10 border-2 border-dashed border-gray-200 rounded-xl text-gray-400">
                                No cash register entry for this day.
                              </div>
                            )}
                          </div>
                        )}

                        {/* ── ATTENDANCE ───────────────────────────────────── */}
                        {activeTab === 'attendance' && (
                          detail.attendance.length === 0
                            ? <Empty>No staff records.</Empty>
                            : (
                              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <thead className="bg-gray-50 border-b border-gray-200">
                                      <tr>
                                        <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Staff</th>
                                        <th className="px-4 py-2.5 text-center font-semibold text-gray-600">Status</th>
                                        <th className="px-4 py-2.5 text-center font-semibold text-gray-600">Check In</th>
                                        <th className="px-4 py-2.5 text-center font-semibold text-gray-600">Check Out</th>
                                        <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Hours</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {detail.attendance.map(r => {
                                        const hasLate = r.lateCheckIn || r.lateCheckOut
                                        const offense =
                                          r.lateCheckIn && r.lateCheckOut ? 'Late IN & Late OUT'
                                          : r.lateCheckIn  ? 'Late IN'
                                          : r.lateCheckOut ? 'Late OUT'
                                          : null
                                        return (
                                          <tr key={r.staffId} className={hasLate ? 'bg-red-50' : 'hover:bg-gray-50/50'}>
                                            <td className="px-4 py-3">
                                              <div className={`font-semibold ${hasLate ? 'text-red-700' : 'text-gray-900'}`}>
                                                {r.staffName}
                                                {offense && (
                                                  <span className="ml-2 px-1.5 py-0.5 bg-red-100 text-red-600 text-[10px] font-bold rounded">
                                                    {offense}
                                                  </span>
                                                )}
                                              </div>
                                              <div className="text-xs text-gray-400">{r.role}</div>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                                                r.status === 'IN'  ? 'bg-emerald-100 text-emerald-700'
                                                : r.status === 'OUT' ? 'bg-blue-100 text-blue-700'
                                                : 'bg-gray-100 text-gray-500'
                                              }`}>{r.status}</span>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                              <div className={r.lateCheckIn ? 'text-red-600 font-semibold' : 'text-gray-700'}>
                                                {fmtT(r.checkIn)}
                                              </div>
                                              {r.lateCheckIn && (
                                                <div className="text-[10px] text-red-500 font-bold">LATE</div>
                                              )}
                                              {r.expectedCheckIn && (
                                                <div className="text-[10px] text-gray-400">exp {r.expectedCheckIn}</div>
                                              )}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                              <div className={r.lateCheckOut ? 'text-red-600 font-semibold' : 'text-gray-700'}>
                                                {fmtT(r.checkOut)}
                                              </div>
                                              {r.lateCheckOut && (
                                                <div className="text-[10px] text-red-500 font-bold">LATE</div>
                                              )}
                                              {r.expectedCheckOut && (
                                                <div className="text-[10px] text-gray-400">exp {r.expectedCheckOut}</div>
                                              )}
                                            </td>
                                            <td className="px-4 py-3 text-right text-gray-700">{fmtH(r.hoursWorked)}</td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                    <tfoot>
                                      <tr className="bg-gray-50 border-t font-bold">
                                        <td className="px-4 py-2.5 text-gray-600" colSpan={4}>Total man-hours</td>
                                        <td className="px-4 py-2.5 text-right">
                                          {fmtH(detail.attendance.reduce((s, a) => s + (a.hoursWorked ?? 0), 0))}
                                        </td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                              </div>
                            )
                        )}

                        {/* ── STOCK ────────────────────────────────────────── */}
                        {activeTab === 'stock' && (
                          <div className="space-y-4">
                            {!detail.hasSession && (
                              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                No inventory session covers this date — opening stock not available. Closing stock shows only today&apos;s movements.
                              </div>
                            )}

                            <div className="grid grid-cols-2 gap-4 mb-4">
                              <Stat label="Opening" value={detail.openingTotal + ' btls'} color="blue" />
                              <Stat label="Closing"  value={detail.closingTotal + ' btls'}  color="emerald" />
                            </div>

                            <SectionTitle>Opening Stock</SectionTitle>
                            <StockTable rows={detail.openingStock} showMovement={false} />

                            <SectionTitle>Closing Stock</SectionTitle>
                            <StockTable rows={detail.closingStock} showMovement />
                          </div>
                        )}
                      </>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Small components ───────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">
      {children}
    </h3>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-center py-10 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
      {children}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className={`rounded-xl p-3 bg-${color}-50 border border-${color}-100`}>
      <div className={`text-[10px] font-bold uppercase tracking-wider text-${color}-500`}>{label}</div>
      <div className={`text-lg font-black text-${color}-700 mt-0.5`}>{value}</div>
    </div>
  )
}

function PayBadge({ mode }: { mode: string }) {
  const map: Record<string, string> = {
    CASH:   'bg-green-100 text-green-700',
    UPI:    'bg-purple-100 text-purple-700',
    CARD:   'bg-blue-100 text-blue-700',
    CREDIT: 'bg-orange-100 text-orange-700',
    SPLIT:  'bg-gray-100 text-gray-600',
    VOID:   'bg-red-100 text-red-600',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${map[mode] ?? 'bg-gray-100 text-gray-600'}`}>
      {mode}
    </span>
  )
}

type Col<T> = { header: string; render: (row: T) => React.ReactNode; align?: 'left' | 'right' | 'center' }

function DataTable<T>({
  rows, cols, empty, footer,
}: { rows: T[]; cols: Col<T>[]; empty: string; footer?: () => React.ReactNode }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {cols.map(c => (
                <th key={c.header} className={`px-4 py-2.5 font-semibold text-gray-600 ${
                  c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                }`}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50/50">
                {cols.map(c => (
                  <td key={c.header} className={`px-4 py-2.5 text-gray-700 ${
                    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''
                  }`}>{c.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot>{footer()}</tfoot>}
        </table>
      </div>
    </div>
  )
}

type StockRow = {
  productSizeId: number; productName: string; category: string; sizeMl: number
  cases: number; bottles: number; totalBottles: number; value: number
  openingBottles?: number; receiptsBottles?: number; salesBottles?: number; adjBottles?: number
}

function StockTable({ rows, showMovement }: { rows: StockRow[]; showMovement: boolean }) {
  if (rows.length === 0) return <Empty>No stock data.</Empty>

  const grouped = rows.reduce<Record<string, StockRow[]>>((acc, r) => {
    if (!acc[r.category]) acc[r.category] = []
    acc[r.category].push(r)
    return acc
  }, {})

  return (
    <div className="space-y-3">
      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{cat}</span>
            <span className="text-xs text-gray-400">{items.reduce((s, r) => s + r.totalBottles, 0)} btls</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50/50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold text-gray-500">Product</th>
                  <th className="text-center px-3 py-2 font-semibold text-gray-500">Size</th>
                  {showMovement && (
                    <>
                      <th className="text-right px-3 py-2 font-semibold text-gray-400 text-xs">Opening</th>
                      <th className="text-right px-3 py-2 font-semibold text-indigo-400 text-xs">+Rcvd</th>
                      <th className="text-right px-3 py-2 font-semibold text-orange-400 text-xs">−Sold</th>
                    </>
                  )}
                  <th className="text-center px-3 py-2 font-semibold text-gray-500">Cases</th>
                  <th className="text-center px-3 py-2 font-semibold text-gray-500">Loose</th>
                  <th className="text-right px-4 py-2 font-semibold text-gray-700">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map(r => (
                  <tr key={r.productSizeId} className="hover:bg-blue-50/20">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{r.productName}</td>
                    <td className="px-3 py-2.5 text-center text-gray-500">{r.sizeMl}ml</td>
                    {showMovement && (
                      <>
                        <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{r.openingBottles ?? 0}</td>
                        <td className="px-3 py-2.5 text-right text-indigo-500 text-xs">{r.receiptsBottles ?? 0}</td>
                        <td className="px-3 py-2.5 text-right text-orange-500 text-xs">{r.salesBottles ?? 0}</td>
                      </>
                    )}
                    <td className="px-3 py-2.5 text-center text-gray-600">{r.cases}</td>
                    <td className="px-3 py-2.5 text-center text-gray-600">{r.bottles}</td>
                    <td className="px-4 py-2.5 text-right font-black text-gray-900">{r.totalBottles}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t border-gray-200">
                  <td className="px-4 py-2 font-bold text-gray-600" colSpan={showMovement ? 5 : 2}>Category Total</td>
                  <td className="px-3 py-2 text-center font-bold text-gray-700">{items.reduce((s, r) => s + r.cases, 0)}</td>
                  <td className="px-3 py-2 text-center font-bold text-gray-700">{items.reduce((s, r) => s + r.bottles, 0)}</td>
                  <td className="px-4 py-2 text-right font-black text-blue-700">{items.reduce((s, r) => s + r.totalBottles, 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
