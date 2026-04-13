import { useState, useEffect, useCallback } from 'react'
import { Save, Plus, Trash2, Banknote, TrendingUp, AlertCircle, CheckCircle } from 'lucide-react'
import type { CashRecord, Expense, DailyTotals } from '../types'

const EXPENSE_CATEGORIES = ['PETTY_CASH', 'CLEANING', 'MAINTENANCE', 'ELECTRICITY', 'SALARY_ADVANCE', 'TRANSPORT', 'OTHER']
const fmtRs = (n: number) => `₹${(n || 0).toFixed(2)}`
const today = () => new Date().toISOString().slice(0, 10)

export default function Cash() {
  const [cashRecord, setCashRecord]   = useState<CashRecord | null>(null)
  const [expenses, setExpenses]       = useState<Expense[]>([])
  const [totals, setTotals]           = useState<DailyTotals | null>(null)
  const [isSaving, setIsSaving]       = useState(false)
  const [toast, setToast]             = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const [newExpense, setNewExpense]    = useState({ particulars: '', category: 'PETTY_CASH', amount: '' })

  // Cash record edit state
  const [opening, setOpening]           = useState('')
  const [cashToLocker, setCashToLocker] = useState('')
  const [closing, setClosing]           = useState('')
  const [creditCollected, setCreditCollected] = useState('')
  const [notes, setNotes]               = useState('')

  const loadData = useCallback(async () => {
    const [rec, exp, tot] = await Promise.all([
      window.posAPI.getTodayCashRecord(),
      window.posAPI.getTodayExpenses(),
      window.posAPI.getTodayTotals(),
    ])
    setCashRecord(rec)
    setExpenses(exp)
    setTotals(tot)

    if (rec) {
      setOpening(String(rec.opening_register || ''))
      setCashToLocker(String(rec.cash_to_locker || ''))
      setClosing(String(rec.closing_register || ''))
      setCreditCollected(String(rec.credit_collected || ''))
      setNotes(rec.notes ?? '')
    }
  }, [])

  useEffect(() => {
    loadData()
    const unsub = window.posAPI.onSyncEvent((event) => {
      if (event === 'push_complete' || event === 'pull_complete') loadData()
    })
    return () => unsub()
  }, [loadData])

  const showToast = (type: 'ok' | 'err', msg: string) => {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }

  // Derived figures
  const cashSales      = totals?.cash_total ?? cashRecord?.cash_sales ?? 0
  const cardSales      = totals?.card_total ?? cashRecord?.card_sales ?? 0
  const upiSales       = totals?.upi_total  ?? cashRecord?.upi_sales  ?? 0
  const totalExpenses  = expenses.reduce((sum, e) => sum + e.amount, 0)
  const openingReg     = parseFloat(opening || '0')
  const locker         = parseFloat(cashToLocker || '0')
  const closingReg     = parseFloat(closing || '0')
  const creditColl     = parseFloat(creditCollected || '0')
  const expectedCash   = openingReg + cashSales + creditColl - totalExpenses - locker
  const variance       = closingReg > 0 ? closingReg - expectedCash : 0

  const handleSaveCash = async () => {
    setIsSaving(true)
    try {
      const result = await window.posAPI.upsertCashRecord({
        record_date: today(),
        opening_register:  openingReg,
        cash_sales:        cashSales,
        expenses:          totalExpenses,
        cash_to_locker:    locker,
        closing_register:  closingReg,
        card_sales:        cardSales,
        upi_sales:         upiSales,
        credit_sales:      0,
        credit_collected:  creditColl,
        notes,
      })
      if (result.ok) {
        showToast('ok', 'Cash record saved')
        loadData()
      } else {
        showToast('err', result.error ?? 'Failed to save')
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddExpense = async () => {
    if (!newExpense.particulars.trim() || !newExpense.amount) return
    const amount = parseFloat(newExpense.amount)
    if (isNaN(amount) || amount <= 0) { showToast('err', 'Enter a valid amount'); return }

    const result = await window.posAPI.insertExpense({
      particulars: newExpense.particulars.trim(),
      category: newExpense.category,
      amount,
    })

    if (result.ok) {
      setNewExpense({ particulars: '', category: 'PETTY_CASH', amount: '' })
      showToast('ok', `Expense added: ${fmtRs(amount)}`)
      loadData()
    } else {
      showToast('err', result.error ?? 'Failed')
    }
  }

  const field = (label: string, value: string, setter: (v: string) => void, readOnly = false) => (
    <div>
      <label className="text-xs text-slate-400 mb-1 block">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => setter(e.target.value)}
        readOnly={readOnly}
        className={`w-full rounded px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500
          ${readOnly ? 'bg-slate-800 text-slate-400 cursor-not-allowed' : 'bg-slate-700 text-white'}`}
        placeholder="0.00"
      />
    </div>
  )

  return (
    <div className="flex h-full bg-slate-900 overflow-hidden">
      {/* Left: cash record */}
      <div className="w-96 flex-shrink-0 border-r border-slate-700 flex flex-col">
        <div className="px-4 py-3 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Cash Register</h2>
            <p className="text-xs text-slate-500">{new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
          {cashRecord?.synced === 0 && (
            <span className="text-xs text-amber-400 bg-amber-900/30 px-2 py-0.5 rounded">Pending sync</span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
          {/* Opening balance */}
          {field('Opening Register (₹)', opening, setOpening)}

          {/* Sales (auto-populated from today's bills) */}
          {field('Cash Sales (₹) — from bills', String(cashSales.toFixed(2)), () => {}, true)}
          {field('Card Sales (₹) — from bills', String(cardSales.toFixed(2)), () => {}, true)}
          {field('UPI Sales (₹) — from bills', String(upiSales.toFixed(2)), () => {}, true)}

          {/* Expenses */}
          {field('Expenses (₹) — from log below', String(totalExpenses.toFixed(2)), () => {}, true)}

          {/* Credit collected */}
          {field('Credit Collected (₹)', creditCollected, setCreditCollected)}

          {/* Cash to locker */}
          {field('Cash to Locker/Safe (₹)', cashToLocker, setCashToLocker)}

          {/* Expected vs actual */}
          <div className="bg-slate-800 rounded-lg p-3 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Expected in register</span>
              <span className="text-slate-200 font-medium">{fmtRs(expectedCash)}</span>
            </div>
            {field('Physical Count (₹)', closing, setClosing)}
            {closing && (
              <div className={`flex justify-between text-xs font-medium ${Math.abs(variance) < 1 ? 'text-emerald-400' : variance > 0 ? 'text-blue-400' : 'text-red-400'}`}>
                <span>Variance</span>
                <span>{variance >= 0 ? '+' : ''}{fmtRs(variance)}</span>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-slate-700 text-white rounded px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
              placeholder="Any notes for today..."
            />
          </div>

          <button
            onClick={handleSaveCash}
            disabled={isSaving}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            <Save size={14} />
            {isSaving ? 'Saving...' : 'Save Cash Record'}
          </button>

          {/* Summary pills */}
          <div className="grid grid-cols-2 gap-2 pt-2">
            {[
              { label: 'Bills today', value: String(totals?.bill_count ?? 0) },
              { label: 'Bottles sold', value: String(totals?.total_bottles ?? 0) },
              { label: 'Gross revenue', value: fmtRs(totals?.gross_revenue ?? 0) },
              { label: 'Expenses', value: fmtRs(totalExpenses) },
            ].map(item => (
              <div key={item.label} className="bg-slate-800 rounded-lg p-2">
                <div className="text-xs text-slate-400">{item.label}</div>
                <div className="text-sm font-semibold text-slate-200">{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right: expenses log */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 bg-slate-800">
          <h2 className="text-sm font-semibold text-slate-200">Expenses</h2>
          <p className="text-xs text-slate-500">{fmtRs(totalExpenses)} total today</p>
        </div>

        {/* Add expense form */}
        <div className="px-4 py-3 border-b border-slate-700 bg-slate-800/50">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-xs text-slate-400 mb-1 block">Particulars</label>
              <input
                type="text"
                value={newExpense.particulars}
                onChange={e => setNewExpense(prev => ({ ...prev, particulars: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleAddExpense()}
                placeholder="Description..."
                className="w-full bg-slate-700 text-slate-200 rounded px-2 py-1.5 text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div className="w-32">
              <label className="text-xs text-slate-400 mb-1 block">Category</label>
              <select
                value={newExpense.category}
                onChange={e => setNewExpense(prev => ({ ...prev, category: e.target.value }))}
                className="w-full bg-slate-700 text-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none"
              >
                {EXPENSE_CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div className="w-28">
              <label className="text-xs text-slate-400 mb-1 block">Amount (₹)</label>
              <input
                type="number"
                value={newExpense.amount}
                onChange={e => setNewExpense(prev => ({ ...prev, amount: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleAddExpense()}
                placeholder="0"
                className="w-full bg-slate-700 text-white rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <button
              onClick={handleAddExpense}
              className="bg-indigo-600 hover:bg-indigo-500 text-white rounded px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors flex-shrink-0"
            >
              <Plus size={14} /> Add
            </button>
          </div>
        </div>

        {/* Expense list */}
        <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
          {expenses.length === 0 ? (
            <div className="text-center text-slate-600 py-12 text-sm flex flex-col items-center gap-2">
              <Banknote size={32} />
              <p>No expenses recorded today</p>
            </div>
          ) : (
            <div className="space-y-2">
              {expenses.map(exp => (
                <div key={exp.local_id} className="flex items-center gap-3 bg-slate-800 rounded-lg px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-200 truncate">{exp.particulars}</div>
                    <div className="text-xs text-slate-500">{exp.category.replace(/_/g, ' ')}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-red-400">{fmtRs(exp.amount)}</span>
                    {exp.synced === 0 && <span className="text-xs text-amber-400">●</span>}
                  </div>
                </div>
              ))}

              <div className="flex justify-between px-3 py-2 bg-slate-800/50 rounded-lg border border-slate-700 mt-2">
                <span className="text-sm font-medium text-slate-300 flex items-center gap-1.5">
                  <TrendingUp size={14} /> Total Expenses
                </span>
                <span className="text-sm font-bold text-red-400">{fmtRs(totalExpenses)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 rounded-lg shadow-xl text-sm font-medium
          ${toast.type === 'ok' ? 'bg-emerald-800 text-emerald-100' : 'bg-red-900 text-red-100'}`}>
          {toast.type === 'ok' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}
