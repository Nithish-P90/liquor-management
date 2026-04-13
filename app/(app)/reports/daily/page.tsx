'use client'
import { useEffect, useState, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

type DaySummary = {
  sessionId:    number
  date:         string
  isLive:       boolean
  closingTotal: number
  hasClosingStock: boolean
  financials: {
    totalSales:      number
    totalExpenses:   number
    netCash:         number
    totalBottlesSold: number
    totalBills:      number
    salesByMode:     Record<string, number>
  }
}

type DayDetail = {
  sessionId:    number
  date:         string
  isToday:      boolean
  financials:   DaySummary['financials']
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
    openingRegister: number | null
    cashSales: number | null
    expenses: number | null
    cashToLocker: number | null
    closingRegister: number | null
    bankDeposits: Array<{ id: number; amount: number; notes: string | null }>
    totalBankDeposited: number
  } | null
}

// ── Formatters ─────────────────────────────────────────────────────────────────

const fmt   = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
const fmtT  = (dt: string | null) =>
  dt ? new Date(dt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'
const fmtH  = (h: number | null) => {
  if (h === null) return '—'
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60)
  return `${hh}h ${mm}m`
}
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

// ── Tab constants ──────────────────────────────────────────────────────────────

const TABS = [
  { key: 'summary',    label: 'Summary'         },
  { key: 'sales',      label: 'Sales'           },
  { key: 'receipts',   label: 'Receipts'        },
  { key: 'expenses',   label: 'Expenses'        },
  { key: 'attendance', label: 'Attendance'      },
  { key: 'adjustments',label: 'Adjustments'     },
  { key: 'opening',    label: 'Opening Stock'   },
  { key: 'closing',    label: 'Closing Stock'   },
] as const

type TabKey = typeof TABS[number]['key']

// ── Main page ──────────────────────────────────────────────────────────────────

export default function DailyLedgerPage() {
  const [summaries,    setSummaries]    = useState<DaySummary[]>([])
  const [expanded,     setExpanded]     = useState<number | null>(null)
  const [activeTab,    setActiveTab]    = useState<TabKey>('summary')
  const [detailCache,  setDetailCache]  = useState<Record<number, DayDetail>>({})
  const [loadingList,  setLoadingList]  = useState(true)
  const [loadingDetail,setLoadingDetail]= useState(false)
  const [downloading,  setDownloading]  = useState<number | null>(null)

  const loadList = useCallback(async () => {
    try {
      const data = await fetch('/api/reports/daily').then(r => r.json())
      setSummaries(Array.isArray(data) ? data : [])
      if (data[0] && expanded === null) setExpanded(data[0].sessionId)
    } finally {
      setLoadingList(false)
    }
  }, [expanded])

  useEffect(() => { loadList() }, [loadList])

  // Auto-refresh list every 60s
  useEffect(() => {
    const id = setInterval(loadList, 60_000)
    return () => clearInterval(id)
  }, [loadList])

  async function loadDetail(sessionId: number) {
    if (detailCache[sessionId]) return
    setLoadingDetail(true)
    try {
      const data = await fetch(`/api/reports/daily/detail?sessionId=${sessionId}`).then(r => r.json())
      setDetailCache(prev => ({ ...prev, [sessionId]: data }))
    } finally {
      setLoadingDetail(false)
    }
  }

  function toggleExpand(sessionId: number) {
    if (expanded === sessionId) {
      setExpanded(null)
    } else {
      setExpanded(sessionId)
      setActiveTab('summary')
      loadDetail(sessionId)
    }
  }

  // Refresh detail for live sessions
  useEffect(() => {
    if (!expanded) return
    const summary = summaries.find(s => s.sessionId === expanded)
    if (!summary?.isLive) return
    const id = setInterval(async () => {
      const data = await fetch(`/api/reports/daily/detail?sessionId=${expanded}`).then(r => r.json())
      setDetailCache(prev => ({ ...prev, [expanded]: data }))
    }, 60_000)
    return () => clearInterval(id)
  }, [expanded, summaries])

  async function downloadSheet(sessionId: number) {
    setDownloading(sessionId)
    try {
      const res  = await fetch(`/api/reports/stock-sheet?sessionId=${sessionId}`)
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `MV-Ledger-${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(null)
    }
  }

  if (loadingList) return (
    <div className="p-8 flex items-center justify-center min-h-64">
      <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="p-6 space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Daily Ledger</h1>
        <div className="text-xs text-gray-400 bg-gray-100 px-3 py-1.5 rounded-lg">
          Closing stock = opening + receipts + adjustments − sales
        </div>
      </div>

      {summaries.length === 0 && (
        <div className="text-center py-12 bg-white border border-gray-200 rounded-xl text-gray-400">
          No sessions found. Create an inventory session to start recording.
        </div>
      )}

      <div className="space-y-3">
        {summaries.map(s => {
          const isExp    = expanded === s.sessionId
          const detail   = detailCache[s.sessionId]

          return (
            <div
              key={s.sessionId}
              className={`bg-white rounded-xl border transition-all ${
                isExp
                  ? 'border-blue-300 shadow-md ring-1 ring-blue-50'
                  : 'border-gray-200 hover:border-blue-200'
              }`}
            >
              {/* ── Summary row ───────────────────────────────────────────── */}
              <button
                onClick={() => toggleExpand(s.sessionId)}
                className="w-full text-left px-6 py-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-5">
                  <div className="bg-blue-50 text-blue-700 font-bold px-3 py-2 rounded-lg text-base min-w-[120px] text-center">
                    {fmtDate(s.date)}
                  </div>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-0.5">
                    <div className="text-sm font-medium text-gray-500">
                      Sales: <span className="font-bold text-gray-900">{fmt(s.financials.totalSales)}</span>
                    </div>
                    <div className="text-sm font-medium text-gray-500">
                      Expenses: <span className="font-bold text-red-600">{fmt(s.financials.totalExpenses)}</span>
                    </div>
                    <div className="text-xs text-gray-400">
                      {s.financials.totalBills} bills · {s.financials.totalBottlesSold} btls sold
                    </div>
                    <div className="text-xs text-green-600 font-medium">Net Cash: {fmt(s.financials.netCash)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  {s.isLive && (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 text-[11px] font-bold rounded-full border border-emerald-200 uppercase tracking-wider">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Live
                    </span>
                  )}
                  {s.hasClosingStock
                    ? <span className="px-2.5 py-1 bg-slate-100 text-slate-700 text-[11px] font-semibold rounded-full border border-slate-200">{s.closingTotal} btls closing</span>
                    : <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-[10px] font-bold rounded uppercase tracking-wider">No Stock</span>
                  }
                  <svg className={`w-5 h-5 text-gray-400 transition-transform ${isExp ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {/* ── Expanded detail ────────────────────────────────────────── */}
              {isExp && (
                <div className="border-t border-gray-100">
                  {/* Tab bar */}
                  <div className="flex gap-0 border-b border-gray-100 bg-gray-50/60 overflow-x-auto">
                    {TABS.map(t => {
                      const count =
                        t.key === 'sales'       ? detail?.sales.length
                        : t.key === 'receipts'  ? detail?.receipts.length
                        : t.key === 'expenses'  ? detail?.expenses.length
                        : t.key === 'attendance'? detail?.attendance.filter(a => a.status !== 'ABSENT').length
                        : t.key === 'adjustments'? detail?.adjustments.length
                        : t.key === 'opening'   ? detail?.openingStock.length
                        : t.key === 'closing'   ? detail?.closingStock.length
                        : undefined
                      return (
                        <button
                          key={t.key}
                          onClick={() => setActiveTab(t.key)}
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
                  <div className="p-5">
                    {loadingDetail && !detail ? (
                      <div className="flex items-center justify-center h-32">
                        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : detail ? (
                      <>
                        {/* ── SUMMARY ──────────────────────────────────────── */}
                        {activeTab === 'summary' && (
                          <div className="grid grid-cols-2 gap-6">
                            <div>
                              <SectionTitle>Financial Breakdown</SectionTitle>
                              <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 text-sm">
                                {[
                                  ['Cash Sales',      fmt(detail.financials.salesByMode.CASH)],
                                  ['UPI / Digital',   fmt(detail.financials.salesByMode.UPI)],
                                  ['Card',            fmt(detail.financials.salesByMode.CARD)],
                                  ['Credit Bills',    fmt(detail.financials.salesByMode.CREDIT)],
                                  ['Split',           fmt(detail.financials.salesByMode.SPLIT)],
                                ].map(([label, val]) => (
                                  <div key={label} className="flex justify-between px-4 py-2.5">
                                    <span className="text-gray-500">{label}</span>
                                    <span className="font-semibold text-gray-900">{val}</span>
                                  </div>
                                ))}
                                <div className="flex justify-between px-4 py-2.5 bg-red-50">
                                  <span className="text-red-700 font-medium">− Expenses</span>
                                  <span className="text-red-700 font-bold">{fmt(detail.financials.totalExpenses)}</span>
                                </div>
                                <div className="flex justify-between px-4 py-3 bg-green-50 border-t border-green-200">
                                  <span className="text-green-800 font-bold">Net Cash</span>
                                  <span className="text-green-800 font-black">{fmt(detail.financials.netCash)}</span>
                                </div>
                              </div>
                            </div>
                            <div className="space-y-4">
                              <div>
                                <SectionTitle>Cash Flow — Galla to Bank</SectionTitle>
                                <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 text-sm">
                                  {detail.cashFlow ? [
                                    ['Opening Register (Galla)', fmt(detail.cashFlow.openingRegister ?? 0), 'text-gray-900'],
                                    ['+ Cash Sales', fmt(detail.cashFlow.cashSales ?? 0), 'text-green-700'],
                                    ['− Expenses', fmt(detail.cashFlow.expenses ?? 0), 'text-red-600'],
                                    ['→ Moved to Locker', fmt(detail.cashFlow.cashToLocker ?? 0), 'text-amber-700'],
                                    ['Closing Register (Galla)', fmt(detail.cashFlow.closingRegister ?? 0), 'text-gray-900 font-black'],
                                  ].map(([label, val, cls]) => (
                                    <div key={label} className="flex justify-between px-4 py-2.5">
                                      <span className="text-gray-500">{label}</span>
                                      <span className={cls}>{val}</span>
                                    </div>
                                  )) : (
                                    <div className="px-4 py-3 text-gray-400 text-sm">No cash register entry for this day.</div>
                                  )}
                                  {(detail.cashFlow?.totalBankDeposited ?? 0) > 0 && (
                                    <div className="flex justify-between px-4 py-2.5 bg-blue-50">
                                      <span className="text-blue-700 font-medium">🏦 Deposited to Bank</span>
                                      <span className="text-blue-700 font-bold">{fmt(detail.cashFlow?.totalBankDeposited ?? 0)}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div>
                                <SectionTitle>Stock at a Glance</SectionTitle>
                                <div className="grid grid-cols-2 gap-3">
                                  {[
                                    { label: 'Opening',  val: detail.openingTotal + ' btls', color: 'blue'   },
                                    { label: 'Received', val: detail.receipts.reduce((s, r) => s + r.totalBottles, 0) + ' btls', color: 'indigo' },
                                    { label: 'Sold',     val: detail.financials.totalBottlesSold + ' btls', color: 'orange' },
                                    { label: 'Closing',  val: detail.closingTotal + ' btls', color: 'emerald' },
                                  ].map(({ label, val, color }) => (
                                    <div key={label} className={`rounded-xl p-3 bg-${color}-50 border border-${color}-100`}>
                                      <div className={`text-xs font-semibold text-${color}-500 uppercase tracking-wider`}>{label}</div>
                                      <div className={`text-xl font-black text-${color}-700 mt-0.5`}>{val}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <SectionTitle>Attendance</SectionTitle>
                                <div className="flex gap-3">
                                  {[
                                    { label: 'Present', val: detail.attendance.filter(a => a.status !== 'ABSENT').length, color: 'emerald' },
                                    { label: 'Absent',  val: detail.attendance.filter(a => a.status === 'ABSENT').length,  color: 'gray'    },
                                  ].map(({ label, val, color }) => (
                                    <div key={label} className={`flex-1 rounded-xl p-3 bg-${color}-50 border border-${color}-200 text-center`}>
                                      <div className={`text-xl font-black text-${color}-700`}>{val}</div>
                                      <div className={`text-xs font-semibold text-${color}-500`}>{label}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* ── SALES ────────────────────────────────────────── */}
                        {activeTab === 'sales' && (
                          <DataTable
                            empty="No sales recorded."
                            rows={detail.sales}
                            cols={[
                              { header: 'Time',    render: r => fmtT(r.time)                                     },
                              { header: 'Product', render: r => (
                                <div>
                                  <div className="font-semibold text-gray-900">{r.productName}</div>
                                  <div className="text-xs text-gray-400">{r.category} · {r.sizeMl}ml</div>
                                </div>
                              )},
                              { header: 'Qty',     render: r => r.qty + ' btl',   align: 'right'                },
                              { header: 'Amount',  render: r => fmt(r.total),      align: 'right'                },
                              { header: 'Mode',    render: r => <PayBadge mode={r.paymentMode} />               },
                              { header: 'Staff',   render: r => r.staffName                                      },
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

                        {/* ── RECEIPTS ─────────────────────────────────────── */}
                        {activeTab === 'receipts' && (
                          <DataTable
                            empty="No indent receipts today."
                            rows={detail.receipts}
                            cols={[
                              { header: 'Indent #',  render: r => (
                                <div>
                                  <div className="font-semibold text-gray-900">{r.indentNumber}</div>
                                  <div className="text-xs text-gray-400">Inv: {r.invoiceNumber}</div>
                                </div>
                              )},
                              { header: 'Product',   render: r => (
                                <div>
                                  <div className="font-semibold text-gray-900">{r.productName}</div>
                                  <div className="text-xs text-gray-400">{r.category} · {r.sizeMl}ml</div>
                                </div>
                              )},
                              { header: 'Cases',     render: r => r.cases,         align: 'right' },
                              { header: 'Loose',     render: r => r.bottles,       align: 'right' },
                              { header: 'Total Btls',render: r => r.totalBottles,  align: 'right' },
                            ]}
                            footer={() => (
                              <tr className="bg-gray-50 border-t font-bold">
                                <td className="px-4 py-2.5 text-gray-600" colSpan={4}>Total received</td>
                                <td className="px-4 py-2.5 text-right">{detail.receipts.reduce((s, r) => s + r.totalBottles, 0)} btls</td>
                              </tr>
                            )}
                          />
                        )}

                        {/* ── EXPENSES ─────────────────────────────────────── */}
                        {activeTab === 'expenses' && (
                          <DataTable
                            empty="No expenses recorded today."
                            rows={detail.expenses}
                            cols={[
                              { header: 'Particulars', render: r => r.particulars                     },
                              { header: 'Category',    render: r => (
                                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-medium">
                                  {r.category}
                                </span>
                              )},
                              { header: 'Amount',      render: r => fmt(r.amount), align: 'right'    },
                            ]}
                            footer={() => (
                              <tr className="bg-red-50 border-t font-bold text-red-700">
                                <td className="px-4 py-2.5" colSpan={2}>Total Expenses</td>
                                <td className="px-4 py-2.5 text-right">{fmt(detail.financials.totalExpenses)}</td>
                              </tr>
                            )}
                          />
                        )}

                        {/* ── ATTENDANCE ───────────────────────────────────── */}
                        {activeTab === 'attendance' && (
                          <DataTable
                            empty="No staff records."
                            rows={detail.attendance}
                            cols={[
                              { header: 'Staff',     render: r => (
                                <div>
                                  <div className="font-semibold text-gray-900">{r.staffName}</div>
                                  <div className="text-xs text-gray-400">{r.role}</div>
                                </div>
                              )},
                              { header: 'Status',    render: r => (
                                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                                  r.status === 'IN'  ? 'bg-emerald-100 text-emerald-700'
                                  : r.status === 'OUT' ? 'bg-blue-100 text-blue-700'
                                  : 'bg-gray-100 text-gray-500'
                                }`}>{r.status}</span>
                              )},
                              { header: 'Check In',  render: r => fmtT(r.checkIn),  align: 'center' },
                              { header: 'Check Out', render: r => fmtT(r.checkOut), align: 'center' },
                              { header: 'Hours',     render: r => fmtH(r.hoursWorked), align: 'right' },
                            ]}
                            footer={() => (
                              <tr className="bg-gray-50 border-t font-bold">
                                <td className="px-4 py-2.5 text-gray-600" colSpan={4}>Total man-hours</td>
                                <td className="px-4 py-2.5 text-right">{fmtH(detail.attendance.reduce((s, a) => s + (a.hoursWorked ?? 0), 0))}</td>
                              </tr>
                            )}
                          />
                        )}

                        {/* ── ADJUSTMENTS ──────────────────────────────────── */}
                        {activeTab === 'adjustments' && (
                          <DataTable
                            empty="No stock adjustments today."
                            rows={detail.adjustments}
                            cols={[
                              { header: 'Product', render: r => (
                                <div>
                                  <div className="font-semibold text-gray-900">{r.productName}</div>
                                  <div className="text-xs text-gray-400">{r.category} · {r.sizeMl}ml</div>
                                </div>
                              )},
                              { header: 'Type',    render: r => (
                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                  r.type === 'BREAKAGE'      ? 'bg-red-100 text-red-700'
                                  : r.type === 'THEFT_WRITEOFF' ? 'bg-red-200 text-red-800'
                                  : r.type === 'RETURN'      ? 'bg-green-100 text-green-700'
                                  : 'bg-gray-100 text-gray-600'
                                }`}>{r.type.replace('_', ' ')}</span>
                              )},
                              { header: 'Qty',     render: r => r.qty + ' btl',           align: 'right' },
                              { header: 'Reason',  render: r => r.reason                                  },
                              { header: 'By',      render: r => r.createdBy                               },
                              { header: 'Status',  render: r => (
                                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                  r.approved ? 'bg-emerald-100 text-emerald-700' : 'bg-yellow-100 text-yellow-700'
                                }`}>{r.approved ? 'Approved' : 'Pending'}</span>
                              )},
                            ]}
                          />
                        )}

                        {/* ── OPENING STOCK ────────────────────────────────── */}
                        {activeTab === 'opening' && (
                          <>
                            <div className="mb-3 flex items-center justify-between">
                              <p className="text-xs text-blue-600 bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-lg">
                                Snapshot: yesterday&apos;s closing stock rolled forward
                              </p>
                              <span className="text-sm font-bold text-gray-700">
                                {detail.openingTotal} total bottles
                              </span>
                            </div>
                            <StockTable rows={detail.openingStock} showMovement={false} />
                          </>
                        )}

                        {/* ── CLOSING STOCK ────────────────────────────────── */}
                        {activeTab === 'closing' && (
                          <>
                            <div className="mb-3 flex items-center justify-between">
                              <p className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-lg">
                                {detail.isToday
                                  ? 'Live: computed every 60 s · will roll forward at day-close'
                                  : 'Final: opening + receipts + adjustments − sales'}
                              </p>
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-bold text-gray-700">
                                  {detail.closingTotal} total bottles
                                </span>
                                <button
                                  onClick={() => downloadSheet(detail.sessionId)}
                                  disabled={downloading === detail.sessionId}
                                  className="text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg disabled:opacity-50"
                                >
                                  {downloading === detail.sessionId ? 'Exporting…' : 'Export Excel'}
                                </button>
                              </div>
                            </div>
                            <StockTable rows={detail.closingStock} showMovement />
                          </>
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

// ── Shared sub-components ──────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">
      {children}
    </h3>
  )
}

function PayBadge({ mode }: { mode: string }) {
  const map: Record<string, string> = {
    CASH:   'bg-green-100 text-green-700',
    UPI:    'bg-purple-100 text-purple-700',
    CARD:   'bg-blue-100 text-blue-700',
    CREDIT: 'bg-red-100 text-red-700',
    SPLIT:  'bg-orange-100 text-orange-700',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${map[mode] ?? 'bg-gray-100 text-gray-600'}`}>
      {mode}
    </span>
  )
}

type Col<T> = {
  header:  string
  render:  (row: T) => React.ReactNode
  align?:  'left' | 'right' | 'center'
}

function DataTable<T>({
  rows, cols, empty, footer,
}: {
  rows:    T[]
  cols:    Col<T>[]
  empty:   string
  footer?: () => React.ReactNode
}) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-10 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
        {empty}
      </div>
    )
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {cols.map(c => (
                <th
                  key={c.header}
                  className={`px-4 py-2.5 font-semibold text-gray-600 ${
                    c.align === 'right' ? 'text-right'
                    : c.align === 'center' ? 'text-center'
                    : 'text-left'
                  }`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                {cols.map(c => (
                  <td
                    key={c.header}
                    className={`px-4 py-2.5 text-gray-700 ${
                      c.align === 'right'  ? 'text-right'
                      : c.align === 'center' ? 'text-center'
                      : ''
                    }`}
                  >
                    {c.render(row)}
                  </td>
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

function StockTable({
  rows,
  showMovement,
}: {
  rows: StockRow[]
  showMovement: boolean
}) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-10 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
        No stock data for this day.
      </div>
    )
  }

  // Group by category
  const grouped = rows.reduce<Record<string, typeof rows>>((acc, r) => {
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
            <span className="text-xs text-gray-400">
              {items.reduce((s, r) => s + r.totalBottles, 0)} btls
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50/50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold text-gray-500">Product</th>
                  <th className="text-center px-4 py-2 font-semibold text-gray-500">Size</th>
                  {showMovement && (
                    <>
                      <th className="text-right px-3 py-2 font-semibold text-gray-400 text-xs">Opening</th>
                      <th className="text-right px-3 py-2 font-semibold text-indigo-400 text-xs">+ Rcvd</th>
                      <th className="text-right px-3 py-2 font-semibold text-orange-400 text-xs">− Sold</th>
                    </>
                  )}
                  <th className="text-center px-4 py-2 font-semibold text-gray-500">Cases</th>
                  <th className="text-center px-4 py-2 font-semibold text-gray-500">Loose</th>
                  <th className="text-right px-4 py-2 font-semibold text-gray-700">Total Btls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map(r => (
                  <tr key={r.productSizeId} className="hover:bg-blue-50/20">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{r.productName}</td>
                    <td className="px-4 py-2.5 text-center text-gray-500">{r.sizeMl}ml</td>
                    {showMovement && (
                      <>
                        <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{r.openingBottles ?? 0}</td>
                        <td className="px-3 py-2.5 text-right text-indigo-500 text-xs">{r.receiptsBottles ?? 0}</td>
                        <td className="px-3 py-2.5 text-right text-orange-500 text-xs">{r.salesBottles ?? 0}</td>
                      </>
                    )}
                    <td className="px-4 py-2.5 text-center text-gray-600">{r.cases}</td>
                    <td className="px-4 py-2.5 text-center text-gray-600">{r.bottles}</td>
                    <td className="px-4 py-2.5 text-right font-black text-gray-900">{r.totalBottles}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t border-gray-200">
                  <td className="px-4 py-2 font-bold text-gray-600" colSpan={showMovement ? 5 : 2}>
                    Category Total
                  </td>
                  <td className="px-4 py-2 text-center font-bold text-gray-700">
                    {items.reduce((s, r) => s + r.cases, 0)}
                  </td>
                  <td className="px-4 py-2 text-center font-bold text-gray-700">
                    {items.reduce((s, r) => s + r.bottles, 0)}
                  </td>
                  <td className="px-4 py-2 text-right font-black text-blue-700">
                    {items.reduce((s, r) => s + r.totalBottles, 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
