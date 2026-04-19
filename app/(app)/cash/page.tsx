'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'

type CashForm = {
  openingRegister: number
  cashSales: number
  expenses: number
  cashToLocker: number
  closingRegister: number
  cardSales: number
  upiSales: number
  notes: string
}

type DaySummary = {
  date: string
  sales: {
    bills: number
    bottles: number
    totalAmount: number
    paymentTotals: {
      cash: number
      card: number
      upi: number
      credit: number
      split: number
      misc: number
    }
  }
  miscSales: {
    totalAmount: number
    items: number
    entries: number
  }
  lastSale: {
    id: number
    saleTime: string
    paymentMode: string
    totalAmount: number
    quantityBottles: number
    productName: string
    sizeMl: number
  } | null
  expenses: {
    total: number
    count: number
    items: {
      id: number
      expDate: string
      particulars: string
      category: string
      amount: number
    }[]
  }
}

type BankData = {
  lockerBalance: number
  bankBalance: number
  totalDeposited: number
  totalKsbcl: number
  transactions: { id: number; txDate: string; txType: string; amount: string; notes: string | null }[]
}

const emptyForm = (openingRegister = 0): CashForm => ({
  openingRegister, cashSales: 0, expenses: 0, cashToLocker: 0,
  closingRegister: 0, cardSales: 0, upiSales: 0, notes: '',
})

function rupee(n: number) {
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

function fmtDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function fmtDateFromISO(iso: string) {
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}

export default function CashPage() {
  const { data: session } = useSession()
  const user = session?.user as { role?: string } | undefined
  const isAdmin = user?.role === 'ADMIN'
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const isToday = date === new Date().toISOString().slice(0, 10)
  const isPast = !isToday
  const [form, setForm] = useState<CashForm>(emptyForm())
  const [summary, setSummary] = useState<DaySummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [bankData, setBankData] = useState<BankData | null>(null)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Bank transaction modal
  const [showBankModal, setShowBankModal] = useState(false)
  const [bankForm, setBankForm] = useState({ txType: 'DEPOSIT', amount: '', notes: '', txDate: new Date().toISOString().slice(0, 10) })
  const [bankSaving, setBankSaving] = useState(false)

  const loadBankData = useCallback(() => {
    fetch('/api/bank', { cache: 'no-store' }).then(r => r.json()).then(setBankData)
  }, [])

  const loadDayData = useCallback(async () => {
    setSaved(false)
    setErrorMsg('')
    setSummaryLoading(true)

    await Promise.all([
      fetch(`/api/cash?date=${date}`, { cache: 'no-store' }).then(r => r.json()),
      fetch(`/api/cash/day-summary?date=${date}`, { cache: 'no-store' }).then(r => r.json()),
    ]).then(([cashRecord, daySummary]) => {
      const hasSavedRecord = typeof cashRecord?.id === 'number'
      setSummary(daySummary)

      if (hasSavedRecord) {
        setForm(prev => ({
          openingRegister: +cashRecord.openingRegister || 0,
          cashSales: +cashRecord.cashSales || 0,
          expenses: +cashRecord.expenses || 0,
          cashToLocker: +cashRecord.cashToLocker || 0,
          closingRegister: +cashRecord.closingRegister || 0,
          cardSales: +cashRecord.cardSales || 0,
          upiSales: +cashRecord.upiSales || 0,
          notes: prev.notes || cashRecord.notes || '',
        }))
      } else {
        setForm(prev => ({
          ...emptyForm(+cashRecord.openingRegister || 0),
          cashSales: daySummary.sales.paymentTotals.cash,
          cardSales: daySummary.sales.paymentTotals.card,
          upiSales: daySummary.sales.paymentTotals.upi,
          expenses: daySummary.expenses.total,
          notes: prev.notes,
        }))
      }
    }).finally(() => setSummaryLoading(false))
  }, [date])

  useEffect(() => {
    void loadDayData()
    loadBankData()
  }, [date, loadBankData, loadDayData])

  useEffect(() => {
    const interval = setInterval(() => {
      void loadDayData()
    }, 30000)
    return () => clearInterval(interval)
  }, [loadDayData])

  useEffect(() => {
    const onMiscUpdated = () => {
      void loadDayData()
    }
    window.addEventListener('misc-sales:updated', onMiscUpdated)
    return () => window.removeEventListener('misc-sales:updated', onMiscUpdated)
  }, [loadDayData])

  // Computed values
  const expectedClosing = form.openingRegister + form.cashSales - form.expenses - form.cashToLocker
  const maxTransfer = Math.max(0, form.openingRegister + form.cashSales - form.expenses)
  const registerVar = form.closingRegister - expectedClosing
  const systemSales = useMemo(() => summary?.sales.paymentTotals ?? { cash: 0, card: 0, upi: 0, credit: 0, split: 0, misc: 0 }, [summary])
  const miscSalesTotal = summary?.miscSales.totalAmount ?? systemSales.misc
  const liquorCashSales = systemSales.cash
  const totalSales = form.cashSales + form.cardSales + form.upiSales
  const systemTotal = systemSales.cash + systemSales.card + systemSales.upi
  const verifyDiff = useMemo(
    () => ({
      cash: form.cashSales - systemSales.cash,
      card: form.cardSales - systemSales.card,
      upi: form.upiSales - systemSales.upi,
      expenses: form.expenses - (summary?.expenses.total ?? 0),
    }),
    [form, summary, systemSales]
  )

  async function save() {
    setErrorMsg('')
    setLoading(true)
    const res = await fetch('/api/cash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recordDate: date,
        cashToLocker: form.cashToLocker,
        closingRegister: isAdmin ? form.closingRegister : undefined,
        notes: form.notes,
      }),
    })
    const saved = await res.json()
    if (!res.ok) {
      setLoading(false)
      setErrorMsg(saved?.error ?? 'Failed to save cash record')
      return
    }
    setForm({
      openingRegister: +saved.openingRegister || 0,
      cashSales: +saved.cashSales || 0,
      expenses: +saved.expenses || 0,
      cashToLocker: +saved.cashToLocker || 0,
      closingRegister: +saved.closingRegister || 0,
      cardSales: +saved.cardSales || 0,
      upiSales: +saved.upiSales || 0,
      notes: saved.notes || '',
    })
    setLoading(false)
    setSaved(true)
  }

  async function saveBankTx() {
    setBankSaving(true)
    setErrorMsg('')
    const res = await fetch('/api/bank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bankForm),
    })
    const data = await res.json()
    if (!res.ok) {
      setBankSaving(false)
      setErrorMsg(data?.error ?? 'Failed to save bank transaction')
      return
    }
    setBankSaving(false)
    setShowBankModal(false)
    setBankForm({ txType: 'DEPOSIT', amount: '', notes: '', txDate: new Date().toISOString().slice(0, 10) })
    loadBankData()
  }

  // Moved out to prevent focus loss
  const renderField = (label: string, k: keyof CashForm, hint?: string, readOnly = false) => (
    <div key={k}>
      <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">{label}</label>
      {hint && <p className="text-xs text-slate-400 mb-1">{hint}</p>}
      <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 bg-white">
        <span className="px-3 py-2 bg-slate-50 text-slate-400 text-sm border-r border-slate-200 font-medium">₹</span>
        <input type="number" min="0" step="1"
          value={(form[k] as number) || ''}
          onChange={e => {
            if (readOnly) return
            setForm({ ...form, [k]: Math.max(0, parseFloat(e.target.value) || 0) })
          }}
          readOnly={readOnly}
          className={`flex-1 px-3 py-2 text-sm outline-none font-semibold ${readOnly ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : 'text-slate-800'}`}
        />
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Cash Register</h1>
          <p className="text-slate-400 text-sm">Daily cash tracking — Counter to Locker to Bank</p>
        </div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
      </div>

      {saved && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 font-semibold text-sm text-center">
          Cash record saved.
          {summary?.lastSale
            ? ` Last sale: ${new Date(summary.lastSale.saleTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} (${summary.lastSale.productName} ${summary.lastSale.sizeMl}ml).`
            : ' No sale found for this day.'}
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 font-semibold text-sm text-center">
          {errorMsg}
        </div>
      )}

      {/* Locker + Bank summary bar */}
      {bankData && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-800 text-white rounded-xl p-4">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-1">Locker Balance</p>
            <p className="text-2xl font-bold">{rupee(bankData.lockerBalance)}</p>
            <p className="text-xs text-slate-500 mt-1">Cash accumulated in safe</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-center">
            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-2">Bank Deposit</p>
            <p className="text-xs text-slate-400 mb-3">Record when locker cash is deposited to bank</p>
            <button
              onClick={() => { if (!isPast) setShowBankModal(true) }}
              disabled={isPast}
              className={`w-full py-2 text-xs font-bold rounded-lg transition-colors ${isPast ? 'bg-slate-300 text-slate-400 cursor-not-allowed' : 'bg-slate-800 text-white hover:bg-slate-700'}`}
            >
              {isPast ? 'Locked — past day' : 'Record Bank Deposit'}
            </button>
          </div>
        </div>
      )}

      {/* System vs Manual Sales */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3">
          Sales — {fmtDate(date)}
        </h2>
        <div className="mb-3">
          <p className="text-xs text-slate-500">Auto-tallied from POS sales and expenditure entries. Counter cash stays in galla unless transferred to locker.</p>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-xs font-semibold text-blue-500 uppercase tracking-wide mb-1">System (POS)</p>
            <p className="text-2xl font-bold text-blue-700">{rupee(systemTotal)}</p>
            <div className="mt-2 text-xs text-blue-500 space-y-0.5">
              <div className="flex justify-between"><span>Cash</span><span className="font-semibold">{rupee(systemSales.cash)}</span></div>
              <div className="flex justify-between"><span>Liquor Cash</span><span className="font-semibold">{rupee(liquorCashSales)}</span></div>
              <div className="flex justify-between"><span>Misc Cash</span><span className="font-semibold">{rupee(miscSalesTotal)}</span></div>
              <div className="flex justify-between"><span>Card</span><span className="font-semibold">{rupee(systemSales.card)}</span></div>
              <div className="flex justify-between"><span>UPI</span><span className="font-semibold">{rupee(systemSales.upi)}</span></div>
            </div>
          </div>
          <div className={`border rounded-xl p-4 ${Math.abs(totalSales - systemTotal) > 10 ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100'}`}>
            <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${Math.abs(totalSales - systemTotal) > 10 ? 'text-red-500' : 'text-emerald-500'}`}>
              Manual Entry
            </p>
            <p className={`text-2xl font-bold ${Math.abs(totalSales - systemTotal) > 10 ? 'text-red-700' : 'text-emerald-700'}`}>{rupee(totalSales)}</p>
            {Math.abs(totalSales - systemTotal) > 1 && (
              <p className="text-xs mt-2 font-semibold text-red-600">Discrepancy: {rupee(Math.abs(totalSales - systemTotal))}</p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3">Manual Verification Matrix</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left">
                <th className="pb-2 text-xs font-semibold text-slate-400">Head</th>
                <th className="pb-2 text-xs font-semibold text-slate-400 text-right">System (Liquor)</th>
                <th className="pb-2 text-xs font-semibold text-slate-400 text-right">Manual</th>
                <th className="pb-2 text-xs font-semibold text-slate-400 text-right">Difference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {[
                { label: 'Cash Sales', system: systemSales.cash, manual: form.cashSales, diff: verifyDiff.cash },
                { label: 'Misc Sales (included in cash)', system: miscSalesTotal, manual: miscSalesTotal, diff: 0 },
                { label: 'Card Sales', system: systemSales.card, manual: form.cardSales, diff: verifyDiff.card },
                { label: 'UPI Sales', system: systemSales.upi, manual: form.upiSales, diff: verifyDiff.upi },
                { label: 'Expenditure', system: summary?.expenses.total ?? 0, manual: form.expenses, diff: verifyDiff.expenses },
              ].map(row => (
                <tr key={row.label}>
                  <td className="py-2 text-slate-700 font-medium">{row.label}</td>
                  <td className="py-2 text-right text-slate-500">{rupee(row.system)}</td>
                  <td className="py-2 text-right text-slate-800 font-semibold">{rupee(row.manual)}</td>
                  <td className={`py-2 text-right font-semibold ${Math.abs(row.diff) > 1 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {row.diff > 0 ? '+' : ''}{rupee(row.diff)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {/* Counter (Galla) */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">Counter Cash (Galla)</h2>
          {renderField('Opening Balance', 'openingRegister', "Auto-carried from yesterday's closing galla", true)}
          <div className="p-3 bg-cyan-50 rounded-lg text-sm flex justify-between border border-cyan-100">
            <span className="text-cyan-700">Misc Sales (cash)</span>
            <strong className="text-cyan-800">{rupee(miscSalesTotal)}</strong>
          </div>
          {renderField('Cash Sales Today', 'cashSales', 'Auto from billed cash + misc sales', true)}
          {renderField('Expenses from Counter', 'expenses', 'Auto from expenditure register', true)}
          {renderField('Transferred to Locker', 'cashToLocker', isPast ? 'Locked — past day' : `Enter only actual transfer made. Max ${rupee(maxTransfer)}`, isPast)}
          <div className="p-3 bg-slate-50 rounded-lg text-sm flex justify-between">
            <span className="text-slate-500">Expected Closing</span>
            <strong className="text-blue-700">{rupee(expectedClosing)}</strong>
          </div>
          {renderField('Closing Register' + (isAdmin && isToday ? '' : ' (Auto)'), 'closingRegister', isPast ? 'Locked — past day' : isAdmin ? 'Admin override — auto-computed value shown above' : 'Auto = opening + billed cash - expenses - locker transfer', !isAdmin || isPast)}
          {registerVar !== 0 && (
            <div className={`p-2.5 rounded-lg text-sm font-semibold flex justify-between ${Math.abs(registerVar) > 200 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
              <span>Variance</span>
              <span>{registerVar > 0 ? '+' : ''}{rupee(registerVar)}</span>
            </div>
          )}
        </div>

        {/* Digital Payments */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">Digital Payments</h2>
          {renderField('Card Sales', 'cardSales', 'Auto from billed card sales', true)}
          {renderField('UPI / PhonePe / Paytm', 'upiSales', 'Auto from billed UPI sales', true)}
          <div className="p-3 bg-slate-50 rounded-lg text-xs text-slate-400">
            System: Card {rupee(summary?.sales.paymentTotals.card || 0)} · UPI {rupee(summary?.sales.paymentTotals.upi || 0)}
          </div>
        </div>
      </div>

      {/* Bank transaction history */}
      {bankData && bankData.transactions.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-700 mb-3">Recent Bank Transactions</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-slate-100">
                {['Date', 'Type', 'Amount', 'Notes'].map(h => (
                  <th key={h} className="pb-2 text-xs font-semibold text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {bankData.transactions.map(t => (
                <tr key={t.id}>
                  <td className="py-2 text-slate-500">{fmtDateFromISO(t.txDate)}</td>
                  <td className="py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${t.txType === 'DEPOSIT' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {t.txType === 'DEPOSIT' ? 'Deposit' : 'KSBCL Payment'}
                    </span>
                  </td>
                  <td className="py-2 font-semibold text-slate-800">{rupee(Number(t.amount))}</td>
                  <td className="py-2 text-slate-400 text-xs">{t.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-700">Day Expenditure Sheet</h2>
          <p className="mt-1 text-xs text-slate-400">This is auto-read from the expenditure register for the selected day.</p>
          <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 flex items-center justify-between">
            <span>Total Expenditure</span>
            <strong>{rupee(summary?.expenses.total ?? 0)}</strong>
          </div>
          <div className="mt-3 max-h-[220px] overflow-auto rounded-lg border border-slate-100">
            {(summary?.expenses.items.length ?? 0) > 0 ? (
              <div className="divide-y divide-slate-50">
                {summary?.expenses.items.map(item => (
                  <div key={item.id} className="p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-700">{item.particulars}</div>
                        <div className="mt-1 text-xs text-slate-400">{item.category}</div>
                      </div>
                      <div className="font-semibold text-slate-700">{rupee(item.amount)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 text-sm text-slate-400">No expenditure entries on this date.</div>
            )}
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className={`bg-white border border-slate-200 rounded-xl p-5 ${isPast ? 'opacity-60' : ''}`}>
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Notes</label>
        <textarea
          value={form.notes}
          onChange={e => { if (!isPast) setForm({ ...form, notes: e.target.value }) }}
          readOnly={isPast}
          rows={2}
          placeholder={isPast ? 'Locked — past day' : 'Any notes for today...'}
          className={`w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none resize-none ${isPast ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : 'focus:ring-2 focus:ring-blue-500'}`}
        />
      </div>

      <div className="flex justify-end">
        {isPast ? (
          <div className="px-8 py-3 bg-slate-200 text-slate-400 rounded-xl font-bold cursor-not-allowed text-sm">
            Past day — read only
          </div>
        ) : (
          <button onClick={save} disabled={loading}
            className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {loading ? 'Saving...' : summaryLoading ? 'Loading day data...' : 'Save Cash Record'}
          </button>
        )}
      </div>

      {/* Bank Deposit / KSBCL Payment Modal */}
      {showBankModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl p-6 w-96 shadow-2xl">
            <h3 className="font-bold text-slate-800 text-base mb-4">Record Bank Transaction</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'DEPOSIT', label: 'Locker → Bank Deposit' },
                    { value: 'KSBCL_PAYMENT', label: 'Bank → KSBCL Payment' },
                  ].map(opt => (
                    <button key={opt.value} onClick={() => setBankForm({ ...bankForm, txType: opt.value })}
                      className={`py-2 text-xs font-semibold rounded-lg border-2 transition-all ${bankForm.txType === opt.value ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">Date</label>
                <input type="date" value={bankForm.txDate} onChange={e => setBankForm({ ...bankForm, txDate: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">Amount</label>
                <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
                  <span className="px-3 py-2 bg-slate-50 text-slate-400 text-sm border-r border-slate-200">₹</span>
                  <input type="number" min="0" value={bankForm.amount} onChange={e => setBankForm({ ...bankForm, amount: e.target.value })}
                    className="flex-1 px-3 py-2 text-sm outline-none font-semibold" placeholder="0" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">Notes (optional)</label>
                <input type="text" value={bankForm.notes} onChange={e => setBankForm({ ...bankForm, notes: e.target.value })}
                  placeholder="e.g. Indent INDBRP26000290"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowBankModal(false)} className="flex-1 py-2 border border-slate-200 rounded-lg text-slate-600 text-sm hover:bg-slate-50">Cancel</button>
              <button onClick={saveBankTx} disabled={bankSaving || !bankForm.amount}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
                {bankSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
