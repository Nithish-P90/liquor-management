'use client'
import { useEffect, useState, useCallback } from 'react'

type ClerkRow = {
  staffId: number
  name: string
  bills: number
  bottles: number
  amount: number
}

function rupee(n: number) {
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

export default function ClerksPage() {
  const [data, setData] = useState<ClerkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const load = useCallback(() => {
    fetch(`/api/clerk-billing?date=${date}`)
      .then(r => r.json())
      .then(d => {
        setData(d)
        setLoading(false)
        setLastUpdated(new Date())
      })
  }, [date])

  useEffect(() => {
    setLoading(true)
    load()
    // Auto-refresh every 30 seconds
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [load])

  const totalAmount = data.reduce((s, r) => s + r.amount, 0)
  const totalBills = data.reduce((s, r) => s + r.bills, 0)
  const totalBottles = data.reduce((s, r) => s + r.bottles, 0)

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Clerk Billing</h1>
          <p className="text-slate-400 text-sm mt-0.5">Real-time billing per clerk · Auto-refreshes every 30s</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-slate-400">
              Updated {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          <button
            onClick={load}
            className="px-3 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 border-l-4 border-l-blue-500 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Total Revenue</p>
          <p className="text-xl font-bold text-slate-900 mt-1">{rupee(totalAmount)}</p>
        </div>
        <div className="bg-white border border-slate-200 border-l-4 border-l-emerald-500 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Total Bills</p>
          <p className="text-xl font-bold text-slate-900 mt-1">{totalBills}</p>
        </div>
        <div className="bg-white border border-slate-200 border-l-4 border-l-violet-500 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Total Bottles</p>
          <p className="text-xl font-bold text-slate-900 mt-1">{totalBottles}</p>
        </div>
      </div>

      {/* Per-clerk table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-700">Per-Clerk Breakdown</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : data.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">No sales recorded for this day</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 font-semibold text-slate-500">Clerk</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-500">Bills</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-500">Bottles</th>
                <th className="text-right px-5 py-3 font-semibold text-slate-500">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.map(row => (
                <tr key={row.staffId} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-semibold text-slate-800">{row.name}</td>
                  <td className="px-4 py-3 text-center text-slate-600">{row.bills}</td>
                  <td className="px-4 py-3 text-center text-slate-600">{row.bottles}</td>
                  <td className="px-5 py-3 text-right font-bold text-slate-900">{rupee(row.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-800 text-white">
              <tr>
                <td className="px-5 py-3 font-bold text-sm">Total</td>
                <td className="px-4 py-3 text-center font-black">{totalBills}</td>
                <td className="px-4 py-3 text-center font-black">{totalBottles}</td>
                <td className="px-5 py-3 text-right font-black">{rupee(totalAmount)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <p className="text-xs text-slate-400">
        Each sale is automatically attributed to the clerk who processed it. Returns and voids adjust the totals.
      </p>
    </div>
  )
}
