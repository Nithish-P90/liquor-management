'use client'
import { useEffect, useState } from 'react'

const PAYMENT_STYLES: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  CASH:    { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Cash'    },
  UPI:     { bg: 'bg-blue-100',    text: 'text-blue-700',    dot: 'bg-blue-500',    label: 'UPI'     },
  CARD:    { bg: 'bg-violet-100',  text: 'text-violet-700',  dot: 'bg-violet-500',  label: 'Card'    },
  SPLIT:   { bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-500',   label: 'Split'   },
  VOID:    { bg: 'bg-red-100',     text: 'text-red-600',     dot: 'bg-red-500',     label: 'Void'    },
  PENDING: { bg: 'bg-orange-100',  text: 'text-orange-700',  dot: 'bg-orange-400',  label: 'Pending' },
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
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
}
function fmt(n: number) {
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

type SaleRow = {
  id: number
  saleTime: string
  saleDate: string
  quantityBottles: number
  sellingPrice: string
  totalAmount: string
  paymentMode: string
  isManualOverride: boolean
  overrideReason: string | null
  billId: string | null
  productSize: { sizeMl: number; product: { name: string; category: string } }
  staff: { id: number; name: string }
}

type SaleRowFull = SaleRow & { productSizeId: number }

type Bill = {
  billKey: string        // billId if present, else synthetic key
  billTime: string       // earliest saleTime in the bill
  isVoid: boolean
  paymentMode: string
  staffName: string
  items: SaleRow[]
  totalAmount: number
  totalBottles: number
}

/** Group individual sale rows into bills.
 *  - Rows with the same non-null billId → one bill
 *  - Rows without billId: group rows from the same staff within a 60-second window
 *  - VOID rows: each gets its own bill card (they are cancellations)
 */
function groupIntoBills(rows: SaleRowFull[]): Bill[] {
  const billMap = new Map<string, Bill>()

  // First pass: rows with explicit billId
  const noBillRows: SaleRow[] = []
  for (const row of rows) {
    if (row.billId) {
      const existing = billMap.get(row.billId)
      if (existing) {
        existing.items.push(row)
        if (row.quantityBottles > 0) {
          existing.totalAmount  += Number(row.totalAmount)
          existing.totalBottles += row.quantityBottles
        }
        // keep earliest time
        if (row.saleTime < existing.billTime) existing.billTime = row.saleTime
      } else {
        billMap.set(row.billId, {
          billKey:      row.billId,
          billTime:     row.saleTime,
          isVoid:       row.paymentMode === 'VOID',
          paymentMode:  row.paymentMode,
          staffName:    row.staff.name,
          items:        [row],
          totalAmount:  row.quantityBottles > 0 ? Number(row.totalAmount) : 0,
          totalBottles: row.quantityBottles > 0 ? row.quantityBottles : 0,
        })
      }
    } else {
      noBillRows.push(row)
    }
  }

  // Second pass: no billId rows — group by same staff + same payment mode + within 60 sec window
  // Sort by staff then time ascending for windowing
  const sorted = [...noBillRows].sort((a, b) => a.staff.id - b.staff.id || a.saleTime.localeCompare(b.saleTime))

  const syntheticBills: Bill[] = []
  let currentBill: Bill | null = null

  for (const row of sorted) {
    const isVoid = row.paymentMode === 'VOID'
    // Void rows always get their own bill
    if (isVoid) {
      syntheticBills.push({
        billKey:      `void-${row.id}`,
        billTime:     row.saleTime,
        isVoid:       true,
        paymentMode:  'VOID',
        staffName:    row.staff.name,
        items:        [row],
        totalAmount:  0,
        totalBottles: Math.abs(row.quantityBottles),
      })
      currentBill = null
      continue
    }

    const withinWindow = currentBill &&
      row.staff.id === currentBill.items[0].staff.id &&
      row.paymentMode === currentBill.paymentMode &&
      (new Date(row.saleTime).getTime() - new Date(currentBill.billTime).getTime()) <= 60_000

    if (withinWindow && currentBill) {
      currentBill.items.push(row)
      currentBill.totalAmount  += Number(row.totalAmount)
      currentBill.totalBottles += row.quantityBottles
    } else {
      currentBill = {
        billKey:      `auto-${row.id}`,
        billTime:     row.saleTime,
        isVoid:       false,
        paymentMode:  row.paymentMode,
        staffName:    row.staff.name,
        items:        [row],
        totalAmount:  Number(row.totalAmount),
        totalBottles: row.quantityBottles,
      }
      syntheticBills.push(currentBill)
    }
  }

  const allBills = [...Array.from(billMap.values()), ...syntheticBills]
  // Sort descending by time
  allBills.sort((a, b) => b.billTime.localeCompare(a.billTime))
  return allBills
}

/** Per-item totals: aggregate by productSizeId across real (non-void) sales */
type ItemTotal = {
  productSizeId: number
  productName: string
  category: string
  sizeMl: number
  totalBottles: number
  totalAmount: number
}

function buildItemTotals(rows: SaleRowFull[]): ItemTotal[] {
  const map = new Map<number, ItemTotal>()
  for (const row of rows) {
    if (row.quantityBottles <= 0) continue
    const key = row.productSizeId
    const existing = map.get(key)
    if (existing) {
      existing.totalBottles += row.quantityBottles
      existing.totalAmount  += Number(row.totalAmount)
    } else {
      map.set(key, {
        productSizeId: key,
        productName:   row.productSize?.product?.name ?? '—',
        category:      row.productSize?.product?.category ?? '—',
        sizeMl:        row.productSize?.sizeMl ?? 0,
        totalBottles:  row.quantityBottles,
        totalAmount:   Number(row.totalAmount),
      })
    }
  }
  return Array.from(map.values()).sort((a, b) => b.totalBottles - a.totalBottles)
}

export default function SalesPage() {
  const [sales, setSales]             = useState<SaleRowFull[]>([])
  const [loading, setLoading]         = useState(true)
  const [date, setDate]               = useState(new Date().toISOString().slice(0, 10))
  const [staffFilter, setStaffFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [staff, setStaff]             = useState<any[]>([])
  const [view, setView]               = useState<'bills' | 'items'>('bills')
  const [expandedBills, setExpandedBills] = useState<Set<string>>(new Set())

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
    fetch(`/api/sales?${params}`)
      .then(r => r.json())
      .then(d => { setSales(Array.isArray(d) ? d : []); setLoading(false) })
  }, [date, staffFilter])

  function toggleBill(key: string) {
    setExpandedBills(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const filtered = paymentFilter ? sales.filter(s => s.paymentMode === paymentFilter) : sales

  const realSales    = sales.filter(s => s.quantityBottles > 0)
  const totalAmount  = (paymentFilter
    ? filtered.filter(s => s.quantityBottles > 0)
    : realSales).reduce((s, x) => s + Number(x.totalAmount), 0)
  const totalBottles = (paymentFilter
    ? filtered.filter(s => s.quantityBottles > 0)
    : realSales).reduce((s, x) => s + x.quantityBottles, 0)

  const voidCount   = sales.filter(s => s.paymentMode === 'VOID').length
  const voidBottles = sales.filter(s => s.paymentMode === 'VOID').reduce((s, x) => s + Math.abs(x.quantityBottles), 0)

  const paymentTotals = realSales.reduce((acc, s) => {
    acc[s.paymentMode] = (acc[s.paymentMode] ?? 0) + Number(s.totalAmount)
    return acc
  }, {} as Record<string, number>)

  const bills = groupIntoBills(filtered)
  const itemTotals = buildItemTotals(realSales)

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

  const PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'SPLIT', 'PENDING', 'VOID']

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
                <div className="grid grid-cols-7 mb-1">
                  {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                    <div key={d} className="text-center text-xs font-bold text-gray-400 py-1">{d}</div>
                  ))}
                </div>
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
                <button onClick={() => { setDate(today); setCalYear(new Date().getFullYear()); setCalMonth(new Date().getMonth()); setShowCal(false) }}
                  className="mt-3 w-full text-xs font-semibold text-blue-600 hover:text-blue-800 text-center">
                  Today
                </button>
              </div>
            )}
          </div>

          {/* Payment filter dropdown */}
          <select
            value={paymentFilter}
            onChange={e => setPaymentFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="">All Types</option>
            {PAYMENT_MODES.map(m => (
              <option key={m} value={m}>{PAYMENT_STYLES[m].label}</option>
            ))}
          </select>

          {/* Staff filter */}
          <select value={staffFilter} onChange={e => setStaffFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
            <option value="">All Staff</option>
            {staff.filter((s: any) => ['ADMIN','CASHIER'].includes(s.role)).map((s: any) =>
              <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="bg-slate-800 text-white rounded-xl px-5 py-3 min-w-[160px]">
          <div className="text-xs text-slate-400 font-medium">
            {paymentFilter ? `${PAYMENT_STYLES[paymentFilter]?.label ?? paymentFilter} Sales` : 'Total Sales'}
          </div>
          <div className="text-xl font-bold">{fmt(totalAmount)}</div>
          <div className="text-xs text-slate-400">{totalBottles} bottles</div>
        </div>
        {/* Per-mode breakdown pills — read-only, no click */}
        {Object.entries(paymentTotals).map(([mode, amount]) => {
          const s = PAYMENT_STYLES[mode] ?? { bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-400', label: mode }
          return (
            <div key={mode} className={`rounded-xl px-4 py-2.5 ${s.bg} ${paymentFilter && paymentFilter !== mode ? 'opacity-40' : ''}`}>
              <div className={`text-xs font-bold flex items-center gap-1.5 ${s.text}`}>
                <span className={`w-2 h-2 rounded-full ${s.dot}`} />{s.label}
              </div>
              <div className={`text-base font-bold ${s.text}`}>{fmt(Number(amount))}</div>
            </div>
          )
        })}
        {voidCount > 0 && (
          <div className={`rounded-xl px-4 py-2.5 bg-red-50 ${paymentFilter && paymentFilter !== 'VOID' ? 'opacity-40' : ''}`}>
            <div className="text-xs font-bold flex items-center gap-1.5 text-red-600">
              <span className="w-2 h-2 rounded-full bg-red-500" />Voided
            </div>
            <div className="text-base font-bold text-red-600">{voidCount} txns · {voidBottles} btls</div>
          </div>
        )}
      </div>

      {/* View toggle */}
      <div className="flex gap-1 border border-gray-200 rounded-lg w-fit overflow-hidden text-xs font-semibold">
        <button onClick={() => setView('bills')}
          className={`px-4 py-2 ${view === 'bills' ? 'bg-gray-800 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
          Bills
        </button>
        <button onClick={() => setView('items')}
          className={`px-4 py-2 ${view === 'items' ? 'bg-gray-800 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
          Per-Item Totals
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : view === 'bills' ? (
        /* ── BILLS VIEW ─────────────────────────────────────────────────────── */
        <div className="space-y-2">
          {bills.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 px-4 py-12 text-center text-gray-400">
              No transactions for this date
            </div>
          )}
          {bills.map((bill, bi) => {
            const isExpanded = expandedBills.has(bill.billKey)
            const s = PAYMENT_STYLES[bill.paymentMode] ?? PAYMENT_STYLES.CASH
            const billNum = bills.length - bi  // bill number from bottom (oldest = #1)

            return (
              <div key={bill.billKey} className={`rounded-xl border overflow-hidden transition-all ${
                bill.isVoid
                  ? 'border-red-200 bg-red-50/40'
                  : 'border-gray-200 bg-white'
              }`}>
                {/* Bill header — always visible */}
                <button
                  onClick={() => toggleBill(bill.billKey)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50/60 transition-colors"
                >
                  {/* Bill number */}
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-xs font-black ${
                    bill.isVoid ? 'bg-red-100 text-red-500' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {bill.isVoid ? '↩' : `#${billNum}`}
                  </div>

                  {/* Time + staff */}
                  <div className="shrink-0 min-w-[90px]">
                    <div className={`text-sm font-semibold tabular-nums ${bill.isVoid ? 'text-red-600' : 'text-gray-800'}`}>
                      {fmtTime(bill.billTime)}
                    </div>
                    <div className="text-xs text-gray-400">{bill.staffName}</div>
                  </div>

                  {/* Items summary */}
                  <div className="flex-1 min-w-0">
                    {bill.isVoid ? (
                      <div className="text-sm text-red-500 font-medium line-through">
                        {bill.items.map(i => i.productSize?.product?.name).join(', ')}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-700 truncate">
                        {bill.items.length === 1
                          ? `${bill.items[0].productSize?.product?.name} · ${bill.items[0].productSize?.sizeMl}ml`
                          : `${bill.items.length} items — ${bill.items.map(i => i.productSize?.product?.name).join(', ')}`
                        }
                      </div>
                    )}
                    <div className="text-xs text-gray-400">
                      {bill.isVoid
                        ? `${bill.totalBottles} btl voided`
                        : `${bill.totalBottles} btl`
                      }
                    </div>
                  </div>

                  {/* Amount + payment badge */}
                  <div className="shrink-0 text-right flex flex-col items-end gap-1">
                    {bill.isVoid ? (
                      <span className="text-sm font-bold text-red-500 line-through">{fmt(bill.items.reduce((s, i) => s + Number(i.totalAmount), 0))}</span>
                    ) : (
                      <span className="text-base font-black text-gray-900">{fmt(bill.totalAmount)}</span>
                    )}
                    <PaymentBadge mode={bill.paymentMode} />
                  </div>

                  {/* Chevron */}
                  <svg className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Expanded item rows */}
                {isExpanded && (
                  <div className="border-t border-gray-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50/80">
                          <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400">Product</th>
                          <th className="text-center px-3 py-2 text-xs font-semibold text-gray-400">Size</th>
                          <th className="text-center px-3 py-2 text-xs font-semibold text-gray-400">Qty</th>
                          <th className="text-right px-3 py-2 text-xs font-semibold text-gray-400">Price</th>
                          <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {bill.items.map(item => {
                          const isVoidRow = item.quantityBottles < 0 || item.paymentMode === 'VOID'
                          return (
                            <tr key={item.id} className={isVoidRow ? 'bg-red-50/60' : ''}>
                              <td className="px-4 py-2.5">
                                <span className={isVoidRow ? 'line-through text-red-400' : 'text-gray-800 font-medium'}>
                                  {item.productSize?.product?.name}
                                </span>
                                {item.isManualOverride && !isVoidRow && (
                                  <span className="ml-1 text-xs text-yellow-600" title={item.overrideReason ?? ''}>⚠</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-center text-gray-500 text-xs">
                                {item.productSize?.sizeMl}ml
                              </td>
                              <td className={`px-3 py-2.5 text-center font-bold ${isVoidRow ? 'text-red-500' : 'text-gray-800'}`}>
                                {isVoidRow ? `−${Math.abs(item.quantityBottles)}` : item.quantityBottles}
                              </td>
                              <td className="px-3 py-2.5 text-right text-gray-500 tabular-nums text-xs">
                                {isVoidRow ? '—' : fmt(Number(item.sellingPrice))}
                              </td>
                              <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${isVoidRow ? 'text-red-400 line-through' : 'text-gray-900'}`}>
                                {fmt(Number(item.totalAmount))}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      {!bill.isVoid && bill.items.length > 1 && (
                        <tfoot>
                          <tr className="bg-gray-50 border-t border-gray-100 font-bold">
                            <td className="px-4 py-2 text-gray-500 text-xs" colSpan={4}>Bill Total</td>
                            <td className="px-4 py-2 text-right text-gray-900">{fmt(bill.totalAmount)}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        /* ── PER-ITEM TOTALS VIEW ────────────────────────────────────────────── */
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Per-Item Sales Totals — {fmtDate(date)}</span>
          </div>
          {itemTotals.length === 0 ? (
            <div className="px-4 py-12 text-center text-gray-400">No sales for this date</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50/60 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-500 text-xs">Product</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-500 text-xs">Category</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-500 text-xs">Size</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-gray-500 text-xs">Bottles Sold</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-gray-500 text-xs">Total Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {itemTotals.map((it, i) => (
                  <tr key={i} className="hover:bg-blue-50/20">
                    <td className="px-4 py-2.5 font-semibold text-gray-900">{it.productName}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-bold uppercase">
                        {it.category}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center text-gray-500 text-xs">{it.sizeMl}ml</td>
                    <td className="px-3 py-2.5 text-right font-bold text-gray-800">
                      {it.totalBottles}
                      <span className="text-xs font-normal text-gray-400 ml-1">btl</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-black text-gray-900">{fmt(it.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t border-gray-200 font-bold">
                  <td className="px-4 py-2.5 text-gray-600" colSpan={3}>Total</td>
                  <td className="px-3 py-2.5 text-right text-gray-800">
                    {itemTotals.reduce((s, i) => s + i.totalBottles, 0)} btl
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-900">{fmt(totalAmount)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
