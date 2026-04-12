'use client'
import { useEffect, useState } from 'react'

const CATEGORIES = ['WAGES', 'RENT', 'ELECTRICITY', 'MAINTENANCE', 'KSBCL_PAYMENT', 'OTHER']

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ expDate: new Date().toISOString().slice(0,10), particulars: '', category: 'OTHER', amount: '' })
  const [saving, setSaving] = useState(false)
  const [fromDate, setFromDate] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0,10) })
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0,10))

  async function load() {
    const data = await fetch(`/api/expenses?from=${fromDate}&to=${toDate}`).then(r => r.json())
    setExpenses(data); setLoading(false)
  }
  useEffect(() => { load() }, [fromDate, toDate])

  async function addExpense(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
    })
    setSaving(false)
    setForm({ expDate: new Date().toISOString().slice(0,10), particulars: '', category: 'OTHER', amount: '' })
    load()
  }

  async function deleteExpense(id: number) {
    if (!confirm('Delete this expense?')) return
    await fetch(`/api/expenses?id=${id}`, { method: 'DELETE' })
    load()
  }

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Expenditure Tracker</h1>

      {/* Add Expense */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-700 mb-4">Add Expense</h2>
        <form onSubmit={addExpense} className="flex gap-3 flex-wrap">
          <input type="date" value={form.expDate} onChange={e => setForm({...form, expDate: e.target.value})}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          <input value={form.particulars} onChange={e => setForm({...form, particulars: e.target.value})} required
            placeholder="Particulars" className="flex-1 min-w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          <select value={form.category} onChange={e => setForm({...form, category: e.target.value})}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
          <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
            <span className="px-3 py-2 bg-gray-50 text-gray-400 text-sm border-r">₹</span>
            <input type="number" min="0" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} required
              placeholder="Amount" className="w-32 px-3 py-2 outline-none text-sm" />
          </div>
          <button type="submit" disabled={saving} className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Adding...' : '+ Add'}
          </button>
        </form>
      </div>

      {/* Filter & Summary */}
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          <span className="self-center text-gray-400">to</span>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        <div className="text-lg font-bold text-gray-900">Total: ₹{total.toLocaleString('en-IN')}</div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Particulars</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Category</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Amount</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {expenses.map(e => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-500">{new Date(e.expDate).toLocaleDateString('en-IN')}</td>
                  <td className="px-4 py-2.5 text-gray-800 font-medium">{e.particulars}</td>
                  <td className="px-4 py-2.5"><span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{e.category}</span></td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900">₹{Number(e.amount).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-2.5 text-center">
                    <button onClick={() => deleteExpense(e.id)} className="text-red-400 hover:text-red-600 text-sm">Delete</button>
                  </td>
                </tr>
              ))}
              {expenses.length === 0 && (
                <tr><td colSpan={5} className="text-center py-10 text-gray-400">No expenses for this period</td></tr>
              )}
            </tbody>
            <tfoot className="bg-gray-50 border-t">
              <tr>
                <td colSpan={3} className="px-4 py-3 font-semibold text-gray-700">TOTAL</td>
                <td className="px-4 py-3 text-right font-bold text-gray-900">₹{total.toLocaleString('en-IN')}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
