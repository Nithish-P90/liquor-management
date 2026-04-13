'use client'
import { useEffect, useState } from 'react'

const PAYMENT_STYLES: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  CASH:  { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Cash' },
  UPI:   { bg: 'bg-blue-100',    text: 'text-blue-700',    dot: 'bg-blue-500',    label: 'UPI' },
  CARD:  { bg: 'bg-violet-100',  text: 'text-violet-700',  dot: 'bg-violet-500',  label: 'Card' },
  SPLIT: { bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-500',   label: 'Split' },
}

function PaymentBadge({ mode }: { mode: string }) {
  const s = PAYMENT_STYLES[mode] ?? { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400', label: mode }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export default function SalesPage() {
  const [sales, setSales]           = useState<any[]>([])
  const [loading, setLoading]       = useState(true)
  const [date, setDate]             = useState(new Date().toISOString().slice(0, 10))
  const [staffFilter, setStaffFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [staff, setStaff]           = useState<any[]>([])

  // Calendar state
  const [calYear, setCalYear]   = useState(new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(new Date().getMonth())
  const [showCal, setShowCal]   = useState(false)

  useEffect(() => {
    fetch('/api/staff').then(r => r.json()).then(setStaff)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams({ date, limit: '500' })
    if (staffFilter) params.set('staffId', staffFilter)
    setLoading(true)
    fetch(`/api/sales?${params}`).then(r => r.json()).then(d => { setSales(Array.isArray(d) ? d : []); setLoading(false) })
  }, [date, staffFilter])

  const filtered = paymentFilter ? sales.filter(s => s.paymentMode === paymentFilter) : sales

  const totalAmount  = filtered.reduce((s, x) => s + Number(x.totalAmount), 0)
  const totalBottles = filtered.reduce((s, x) => s + x.quantityBottles, 0)
  const paymentTotals = sales.reduce((acc, s) => {
    acc[s.paymentMode] = (acc[s.paymentMode] ?? 0) + Number(s.totalAmount)
    return acc
  }, {} as Record<string, number>)

  // Calendar helpers
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
  const firstDay    = new Date(calYear, calMonth, 1).getDay()
  const today       = new Date().toISOString().slice(0, 10)
  const months      = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const years       = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)

  function selectDay(d: number) {
    const iso = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    setDate(iso)
    setShowCal(false)
  }

  const PAYMENT_MODES = Object.keys(PAYMENT_STYLES)

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Sales Log</h1>
        <div className="flex gap-2 flex-wrap items-center">

          {/* Calendar picker */}
          <div className="relative">
            <button
              onClick={() => setShowCal(v => !v)}
              className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:border-blue-400 hover:bg-blue-50 transition-colors"
            >
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {fmtDate(date)}
            </button>

            {showCal && (
              <div className="absolute right-0 top-11 z-50 bg-white border border-gray-200 rounded-2xl shadow-xl p-4 w-72">
                {/* Month/Year controls */}
                <div className="flex items-center justify-between mb-3 gap-2">
                  <button onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1) } else setCalMonth(m => m - 1) }}
                    className="p-1 rounded-lg hover:bg-gray-100 text-gray-500">‹</button>
                  <div className="flex gap-2">
                    <select value={calMonth} onChange={e => setCalMonth(Number(e.target.value))}
                      className="text-sm font-semibold text-gray-700 border-0 outline-none bg-transparent cursor-pointer">
                      {months.map((m, i) => <option key={m} value={i}>{m}</option>)}
                    </select>
                    <select value={calYear} onChange={e => setCalYear(Number(e.target.value))}
                      className="text-sm font-semibold text-gray-700 border-0 outline-none bg-transparent cursor-pointer">
                      {years.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                  <button onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1) } else setCalMonth(m => m + 1) }}
                    className="p-1 rounded-lg hover:bg-gray-100 text-gray-500">›</button>
                </div>

                {/* Day headers */}
                <div className="grid grid-cols-7 mb-1">
                  {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                    <div key={d} className="text-center text-xs font-bold text-gray-400 py-1">{d}</div>
                  ))}
                </div>

                {/* Days */}
                <div className="grid grid-cols-7 gap-y-1">
                  {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
                  {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
                    const iso = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                    const isSelected = iso === date
                    const isToday    = iso === today
                    const isFuture   = iso > today
                    return (
                      <button key={d} onClick={() => !isFuture && selectDay(d)} disabled={isFuture}
                        className={`text-center text-sm py-1.5 rounded-lg font-medium transition-colors
                          ${isSelected ? 'bg-blue-600 text-white' :
                            isToday    ? 'bg-blue-50 text-blue-600 font-bold' :
                            isFuture   ? 'text-gray-200 cursor-not-allowed' :
                                         'text-gray-700 hover:bg-gray-100'}`}>
                        {d}
                      </button>
                    )
                  })}
                </div>

                {/* Today button */}
                <button onClick={() => { setDate(today); setCalYear(new Date().getFullYear()); setCalMonth(new Date().getMonth()); setShowCal(false) }}
                  className="mt-3 w-full text-xs font-semibold text-blue-600 hover:text-blue-800 text-center">
                  Today
                </button>
              </div>
            )}
          </div>

          {/* Payment filter tabs */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
            <button onClick={() => setPaymentFilter('')}
              className={`px-3 py-2 ${paymentFilter === '' ? 'bg-gray-800 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
              All
            </button>
            {PAYMENT_MODES.map(m => {
              const s = PAYMENT_STYLES[m]
              return (
                <button key={m} onClick={() => setPaymentFilter(paymentFilter === m ? '' : m)}
                  className={`px-3 py-2 transition-colors ${paymentFilter === m ? `${s.bg} ${s.text}` : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                  {s.label}
                </button>
              )
            })}
          </div>

          {/* Staff filter */}
          <select value={staffFilter} onChange={e => setStaffFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
            <option value="">All Staff</option>
            {staff.filter((s: any) => ['ADMIN','CASHIER'].includes(s.role)).map((s: any) =>
              <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="flex gap-3 flex-wrap">
        <div className="bg-slate-800 text-white rounded-xl px-5 py-3 min-w-[140px]">
          <div className="text-xs text-slate-400 font-medium">Total Sales</div>
          <div className="text-xl font-bold">₹{totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          <div className="text-xs text-slate-400">{totalBottles} bottles</div>
        </div>
        {Object.entries(paymentTotals).map(([mode, amount]) => {
          const s = PAYMENT_STYLES[mode] ?? { bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-400', label: mode }
          return (
            <button key={mode} onClick={() => setPaymentFilter(paymentFilter === mode ? '' : mode)}
              className={`rounded-xl px-5 py-3 min-w-[120px] text-left border-2 transition-all ${s.bg}
                ${paymentFilter === mode ? 'border-current shadow-md scale-105' : 'border-transparent'}`}>
              <div className={`text-xs font-bold flex items-center gap-1.5 ${s.text}`}>
                <span className={`w-2 h-2 rounded-full ${s.dot}`} />{s.label}
              </div>
              <div className={`text-lg font-bold ${s.text}`}>₹{Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
            </button>
          )
        })}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs">Time</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs">Product</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-500 text-xs">Size</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-500 text-xs">Qty</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs">Price</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs">Total</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-500 text-xs">Payment</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs">Staff</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(s => (
                <tr key={s.id} className={`hover:bg-gray-50 transition-colors ${s.isManualOverride ? 'bg-yellow-50' : ''}`}>
                  <td className="px-4 py-2.5 text-gray-400 text-xs tabular-nums">
                    {new Date(s.saleTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">
                    {s.productSize?.product?.name}
                    {s.isManualOverride && <span className="ml-1 text-xs text-yellow-600" title={s.overrideReason}>⚠️</span>}
                  </td>
                  <td className="px-4 py-2.5 text-center text-gray-500 text-xs">{s.productSize?.sizeMl}ml</td>
                  <td className="px-4 py-2.5 text-center font-bold text-gray-800">{s.quantityBottles}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">₹{Number(s.sellingPrice).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-gray-900 tabular-nums">₹{Number(s.totalAmount).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-2.5 text-center"><PaymentBadge mode={s.paymentMode} /></td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{s.staff?.name}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">No sales for this date</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
