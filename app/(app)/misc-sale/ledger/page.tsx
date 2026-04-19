'use client'
import { useCallback, useEffect, useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type MiscCategory = 'CIGARETTES' | 'SNACKS' | 'CUPS'

type RangeDay = {
  isoDate: string          // YYYY-MM-DD
  totalAmount: number
  totalItems: number
  totalEntries: number
  byMode: Array<{ mode: string; amount: number; qty: number }>
  categories: Record<MiscCategory, { amount: number; items: number; entries: number }>
}

type SaleRow = {
  id: number
  saleTime: string
  paymentMode: string
  staffName: string
  quantity: number
  unitPrice: number
  totalAmount: number
  item: { name: string; category: MiscCategory; unit: string }
}

type DayDetail = {
  date: string
  summary: {
    totalAmount: number
    items: number
    entries: number
    categories: Record<MiscCategory, { items: number; amount: number; entries: number }>
  }
  rows: SaleRow[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CAT_LABEL: Record<MiscCategory, string> = {
  CIGARETTES: 'Cigarettes',
  SNACKS:     'Snacks',
  CUPS:       'Cups',
}

const CAT_BADGE: Record<MiscCategory, string> = {
  CIGARETTES: 'bg-amber-100 text-amber-700',
  SNACKS:     'bg-emerald-100 text-emerald-700',
  CUPS:       'bg-blue-100 text-blue-700',
}

const MODE_BADGE: Record<string, string> = {
  CASH:   'bg-green-100 text-green-700',
  UPI:    'bg-purple-100 text-purple-700',
  CARD:   'bg-blue-100 text-blue-700',
  CREDIT: 'bg-orange-100 text-orange-700',
  SPLIT:  'bg-gray-100 text-gray-600',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt   = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
const fmtT  = (s: string) => new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })

function fmtDate(iso: string) {
  const d = new Date(iso + 'T00:00:00Z')
  return {
    day:     String(d.getUTCDate()).padStart(2, '0'),
    month:   d.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' }),
    year:    d.getUTCFullYear(),
    weekday: d.toLocaleString('en-IN', { weekday: 'short', timeZone: 'UTC' }),
  }
}

function isToday(iso: string) {
  const today = new Date()
  return (
    iso === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  )
}

// Build last-N days range params
function buildRangeParams(days = 60) {
  const to   = new Date()
  const from = new Date(); from.setDate(from.getDate() - days + 1)
  const fmt2 = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { from: fmt2(from), to: fmt2(to) }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MiscLedgerPage() {
  const [days,          setDays]          = useState<RangeDay[]>([])
  const [expanded,      setExpanded]      = useState<string | null>(null)
  const [detailCache,   setDetailCache]   = useState<Record<string, DayDetail>>({})
  const [loadingList,   setLoadingList]   = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // ── Load list ───────────────────────────────────────────────────────────────

  const loadList = useCallback(async () => {
    const { from, to } = buildRangeParams(60)
    try {
      const res = await fetch(`/api/misc-sales?from=${from}&to=${to}`, { cache: 'no-store' })
      if (!res.ok) { setDays([]); return }
      const data = await res.json() as {
        totalAmount: number
        totalItems:  number
        totalEntries: number
        byMode: Array<{ mode: string; amount: number; qty: number }>
        categories: Record<MiscCategory, { amount: number; items: number; entries: number }>
      }

      // The range endpoint returns a single aggregate — we need per-day rows.
      // Fetch per-day breakdown using the daily API summmary list instead.
      // We'll use a different strategy: fetch the last 60 dates individually in batch.
      // Actually, /api/misc-sales?from=&to= returns one aggregate summary.
      // We need to build per-day rows ourselves from the daily report endpoint.
      // Use /api/reports/daily which has misc data per day.
      const dailyRes = await fetch('/api/reports/daily', { cache: 'no-store' })
      if (!dailyRes.ok) { setDays([]); return }
      const dailyArr = await dailyRes.json() as Array<{
        date: string
        isLive: boolean
        financials: {
          miscSalesTotal?: number
          miscItemsSold?: number
          miscEntries?: number
          salesByMode?: Record<string, number>
        }
      }>

      // Filter to days that have misc activity, build RangeDay objects
      const result: RangeDay[] = dailyArr
        .filter(d => (d.financials.miscSalesTotal ?? 0) > 0)
        .map(d => {
          const isoDate = (() => {
            const dt = new Date(d.date)
            return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
          })()
          return {
            isoDate,
            totalAmount:  d.financials.miscSalesTotal  ?? 0,
            totalItems:   d.financials.miscItemsSold   ?? 0,
            totalEntries: d.financials.miscEntries     ?? 0,
            byMode: [],                // filled from detail on expand
            categories: {             // filled from detail on expand
              CIGARETTES: { amount: 0, items: 0, entries: 0 },
              SNACKS:     { amount: 0, items: 0, entries: 0 },
              CUPS:       { amount: 0, items: 0, entries: 0 },
            },
          }
        })

      setDays(result)

      // Auto-expand today if it has data
      if (result.length > 0 && expanded === null) {
        const first = result[0]
        setExpanded(first.isoDate)
        void loadDetail(first.isoDate)
      }
    } finally {
      setLoadingList(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { void loadList() }, [loadList])
  useEffect(() => {
    const id = setInterval(() => void loadList(), 60_000)
    return () => clearInterval(id)
  }, [loadList])

  // ── Load detail ─────────────────────────────────────────────────────────────

  async function loadDetail(isoDate: string) {
    if (detailCache[isoDate]) return
    setLoadingDetail(true)
    try {
      const res = await fetch(`/api/misc-sales?date=${isoDate}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json() as {
        date: string
        summary: DayDetail['summary']
        rows: Array<{
          id: number
          saleTime: string
          paymentMode: string
          staffName: string
          quantity: number
          unitPrice: number
          totalAmount: number
          item: { name: string; category: MiscCategory; unit: string }
        }>
      }
      setDetailCache(prev => ({ ...prev, [isoDate]: data }))

      // Enrich the day entry with category + mode breakdown from detail
      setDays(prev => prev.map(d => {
        if (d.isoDate !== isoDate) return d
        const byMode: Array<{ mode: string; amount: number; qty: number }> = []
        const modeMap = new Map<string, { amount: number; qty: number }>()
        const catMap: Record<string, { amount: number; items: number; entries: number }> = {
          CIGARETTES: { amount: 0, items: 0, entries: 0 },
          SNACKS:     { amount: 0, items: 0, entries: 0 },
          CUPS:       { amount: 0, items: 0, entries: 0 },
        }
        for (const r of data.rows) {
          const m = modeMap.get(r.paymentMode) ?? { amount: 0, qty: 0 }
          m.amount += Number(r.totalAmount); m.qty += r.quantity
          modeMap.set(r.paymentMode, m)
          if (catMap[r.item.category]) {
            catMap[r.item.category].amount  += Number(r.totalAmount)
            catMap[r.item.category].items   += r.quantity
            catMap[r.item.category].entries += 1
          }
        }
        for (const [mode, v] of modeMap.entries()) byMode.push({ mode, amount: v.amount, qty: v.qty })
        byMode.sort((a, b) => b.amount - a.amount)
        return { ...d, byMode, categories: catMap as RangeDay['categories'] }
      }))
    } finally {
      setLoadingDetail(false)
    }
  }

  function toggle(isoDate: string) {
    if (expanded === isoDate) { setExpanded(null); return }
    setExpanded(isoDate)
    void loadDetail(isoDate)
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loadingList) return (
    <div className="p-8 flex items-center justify-center min-h-64">
      <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="p-4 lg:p-6 space-y-3 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Misc Sales Ledger</h1>
          <p className="text-slate-400 text-xs mt-0.5">Day-by-day cashier revenue (cigarettes, snacks, cups)</p>
        </div>
        <span className="text-xs text-slate-400 bg-slate-100 px-3 py-1.5 rounded-lg">
          {days.length} days with activity
        </span>
      </div>

      {days.length === 0 && (
        <div className="text-center py-16 bg-white border border-slate-200 rounded-xl text-slate-400">
          <div className="text-4xl mb-3">🧾</div>
          <div className="font-semibold text-slate-500">No misc sales yet</div>
          <div className="text-sm mt-1">Misc sales recorded via the POS will appear here day by day.</div>
        </div>
      )}

      <div className="space-y-2">
        {days.map(day => {
          const df     = fmtDate(day.isoDate)
          const live   = isToday(day.isoDate)
          const isExp  = expanded === day.isoDate
          const detail = detailCache[day.isoDate]

          return (
            <div key={day.isoDate} className={`bg-white rounded-xl border transition-all ${
              isExp ? 'border-cyan-300 shadow-md' : 'border-slate-200 hover:border-cyan-200'
            }`}>

              {/* ── Row header ──────────────────────────────────────────────── */}
              <button
                onClick={() => toggle(day.isoDate)}
                className="w-full text-left px-4 py-3 flex items-center gap-4"
              >
                {/* Date block */}
                <div className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl shrink-0 ${
                  live ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-700'
                }`}>
                  <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">{df.weekday}</span>
                  <span className="text-xl font-black leading-none">{df.day}</span>
                  <span className="text-[10px] font-semibold uppercase">{df.month}</span>
                </div>

                {/* Stats */}
                <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-0.5 text-sm">
                  {/* Total */}
                  <div>
                    <span className="text-slate-400 text-xs">Total Revenue</span>
                    <div className="font-bold text-cyan-700">{fmt(day.totalAmount)}</div>
                    <div className="text-[11px] text-slate-400">{day.totalEntries} entries · {day.totalItems} items</div>
                  </div>

                  {/* Categories inline — shown once detail loaded, else compact */}
                  {((['CIGARETTES', 'SNACKS', 'CUPS'] as MiscCategory[])).map(cat => {
                    const c = day.categories[cat]
                    return (
                      <div key={cat}>
                        <span className="text-slate-400 text-xs">{CAT_LABEL[cat]}</span>
                        <div className="font-semibold text-slate-800">{c.items > 0 ? fmt(c.amount) : '—'}</div>
                        {c.items > 0 && <div className="text-[11px] text-slate-400">{c.items} sold</div>}
                      </div>
                    )
                  })}
                </div>

                {/* Live + chevron */}
                <div className="flex items-center gap-2 shrink-0">
                  {live && (
                    <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded-full border border-emerald-200 uppercase">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live
                    </span>
                  )}
                  <svg className={`w-4 h-4 text-slate-400 transition-transform ${isExp ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {/* ── Expanded detail ──────────────────────────────────────────── */}
              {isExp && (
                <div className="border-t border-slate-100 p-4 space-y-4">

                  {loadingDetail && !detail ? (
                    <div className="flex items-center justify-center h-24">
                      <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : detail ? (
                    <>
                      {/* Summary cards */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-3 text-center">
                          <p className="text-[10px] font-bold text-cyan-400 uppercase tracking-wide mb-0.5">Revenue</p>
                          <p className="text-xl font-black text-cyan-800">{fmt(detail.summary.totalAmount)}</p>
                        </div>
                        {(['CIGARETTES', 'SNACKS', 'CUPS'] as MiscCategory[]).map(cat => {
                          const c = detail.summary.categories[cat]
                          return (
                            <div key={cat} className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-0.5">{CAT_LABEL[cat]}</p>
                              <p className="text-xl font-black text-slate-800">{c.items}</p>
                              <p className="text-xs text-slate-500">{fmt(c.amount)}</p>
                            </div>
                          )
                        })}
                      </div>

                      {/* By payment mode */}
                      {day.byMode.length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">By Payment Mode</p>
                          <div className="flex flex-wrap gap-2">
                            {day.byMode.map(m => (
                              <div key={m.mode} className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${MODE_BADGE[m.mode] ?? 'bg-gray-100 text-gray-600'}`}>
                                  {m.mode}
                                </span>
                                <span className="font-bold text-slate-800">{fmt(m.amount)}</span>
                                <span className="text-xs text-slate-400">{m.qty} items</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Transaction table */}
                      {detail.rows.length === 0 ? (
                        <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-sm">
                          No transactions recorded for this day.
                        </div>
                      ) : (
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Transactions</p>
                          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-slate-100 bg-slate-50">
                                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400">Time</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400">Item</th>
                                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-400">Category</th>
                                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-400">Qty</th>
                                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-400">Unit ₹</th>
                                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-400">Total</th>
                                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-400">Mode</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400">Staff</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                  {detail.rows.map(row => (
                                    <tr key={row.id} className="hover:bg-slate-50">
                                      <td className="px-4 py-2.5 text-slate-500 tabular-nums">{fmtT(row.saleTime)}</td>
                                      <td className="px-4 py-2.5 font-medium text-slate-800">{row.item.name}</td>
                                      <td className="px-4 py-2.5 text-center">
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${CAT_BADGE[row.item.category]}`}>
                                          {CAT_LABEL[row.item.category]}
                                        </span>
                                      </td>
                                      <td className="px-4 py-2.5 text-right font-bold text-slate-700">
                                        {row.quantity} <span className="text-xs font-normal text-slate-400">{row.item.unit}</span>
                                      </td>
                                      <td className="px-4 py-2.5 text-right text-slate-600">{fmt(row.unitPrice)}</td>
                                      <td className="px-4 py-2.5 text-right font-bold text-slate-900">{fmt(row.totalAmount)}</td>
                                      <td className="px-4 py-2.5 text-center">
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${MODE_BADGE[row.paymentMode] ?? 'bg-gray-100 text-gray-600'}`}>
                                          {row.paymentMode}
                                        </span>
                                      </td>
                                      <td className="px-4 py-2.5 text-slate-500 text-xs">{row.staffName}</td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="bg-cyan-50 border-t border-cyan-100 font-bold text-cyan-800">
                                    <td className="px-4 py-2.5" colSpan={3}>Total</td>
                                    <td className="px-4 py-2.5 text-right">{detail.summary.items} items</td>
                                    <td />
                                    <td className="px-4 py-2.5 text-right">{fmt(detail.summary.totalAmount)}</td>
                                    <td colSpan={2} />
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
