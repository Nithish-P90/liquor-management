'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type DailyLedger = {
  sessionId: number
  date: string
  financials: {
    totalSales: number
    totalExpenses: number
    netCash: number
    salesByMode: { CASH: number; UPI: number; CARD: number; CREDIT: number; SPLIT: number }
    totalBottlesSold: number
    totalBills: number
  }
  closingStock: Record<string, { totalBottles: number; value: number }>
  hasClosingStock: boolean
  indents?: {
    totalBottles: number
    totalValue: number
  }
}

function fmt(n: number) {
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

export default function DailyLedgerPage() {
  const [ledgers, setLedgers] = useState<DailyLedger[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [downloading, setDownloading] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/reports/daily')
      .then(r => r.json())
      .then(data => { setLedgers(data); setLoading(false); if (data[0]) setExpandedId(data[0].sessionId) })
  }, [])

  async function downloadStockSheet(sessionId: number) {
    setDownloading(sessionId)
    try {
      const res = await fetch(`/api/reports/stock-sheet?sessionId=${sessionId}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `MV-Ledger-${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(null)
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Daily Ledgers</h1>
        <div className="text-sm text-gray-500 bg-gray-100 px-4 py-2 rounded-lg font-medium">
          Matches Today&apos;s Closing with Tomorrow&apos;s Opening
        </div>
      </div>

      <div className="space-y-4">
        {ledgers.length === 0 && (
          <div className="text-center py-10 bg-white border border-gray-200 rounded-xl text-gray-500">
            No daily logs found. Close a day to generate a ledger.
          </div>
        )}

        {ledgers.map(l => {
          const isExp = expandedId === l.sessionId
          return (
            <div key={l.sessionId} className={`bg-white rounded-xl border transition-all ${isExp ? 'border-blue-300 shadow-md ring-1 ring-blue-50' : 'border-gray-200 hover:border-blue-200'}`}>
              
              {/* Header / Summary Row */}
              <button onClick={() => setExpandedId(isExp ? null : l.sessionId)} className="w-full text-left px-6 py-4 flex items-center justify-between group">
                <div className="flex items-center gap-6">
                  <div className="bg-blue-50 text-blue-700 font-bold px-3 py-2 rounded-lg text-lg min-w-32 text-center">
                    {new Date(l.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                    <div className="text-sm font-medium text-gray-500">Total Sales: <span className="font-bold text-gray-900">{fmt(l.financials.totalSales)}</span></div>
                    <div className="text-sm font-medium text-gray-500">Expenses: <span className="font-bold text-red-600">{fmt(l.financials.totalExpenses)}</span></div>
                    <div className="text-xs text-gray-400">{l.financials.totalBills} bills • {l.financials.totalBottlesSold} btls</div>
                    <div className="text-xs text-green-600 font-medium">Net Cash: {fmt(l.financials.netCash)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {!l.hasClosingStock && <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-[10px] font-bold rounded uppercase tracking-wider">No Closing Stock</span>}
                  <svg className={`w-5 h-5 text-gray-400 transition-transform ${isExp ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {/* Expanded Details */}
              {isExp && (
                <div className="border-t border-gray-100 bg-gray-50/50 p-6 grid grid-cols-2 gap-8">
                  
                  {/* Financial Breakdown */}
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                         Financial Breakdown
                      </h3>
                    <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
                      <div className="flex justify-between px-4 py-2.5 text-sm">
                        <span className="text-gray-600">Cash Sales</span>
                        <span className="font-semibold text-gray-900">{fmt(l.financials.salesByMode.CASH)}</span>
                      </div>
                      <div className="flex justify-between px-4 py-2.5 text-sm">
                        <span className="text-gray-600">UPI / Digital</span>
                        <span className="font-semibold text-gray-900">{fmt(l.financials.salesByMode.UPI)}</span>
                      </div>
                      <div className="flex justify-between px-4 py-2.5 text-sm">
                        <span className="text-gray-600">Card Swipes</span>
                        <span className="font-semibold text-gray-900">{fmt(l.financials.salesByMode.CARD)}</span>
                      </div>
                      <div className="flex justify-between px-4 py-2.5 text-sm">
                        <span className="text-gray-600">Credit Bills</span>
                        <span className="font-semibold text-gray-900">{fmt(l.financials.salesByMode.CREDIT)}</span>
                      </div>
                      <div className="flex justify-between px-4 py-2.5 text-sm">
                        <span className="text-gray-600">Split Cash/UPI</span>
                        <span className="font-semibold text-gray-900">{fmt(l.financials.salesByMode.SPLIT)}</span>
                      </div>
                      <div className="flex justify-between px-4 py-3 bg-red-50 text-sm">
                        <span className="text-red-700 font-medium">Minus Expenses</span>
                        <span className="text-red-700 font-bold">− {fmt(l.financials.totalExpenses)}</span>
                      </div>
                      <div className="flex justify-between px-4 py-3 bg-green-50 text-sm border-t border-green-200">
                        <span className="text-green-800 font-medium">Net Hand Cash / Locker</span>
                        <span className="text-green-800 font-bold">{fmt(l.financials.netCash)}</span>
                      </div>
                    </div>
                    </div>

                    {/* Indent Inward Flow */}
                    <div>
                      <h3 className="text-xs font-bold text-indigo-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                         KSBCL Indents Uploaded
                      </h3>
                      {l.indents && l.indents.totalBottles > 0 ? (
                        <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 flex justify-between items-center">
                          <div>
                            <div className="text-sm font-bold text-indigo-900">{l.indents.totalBottles} bottles received</div>
                            <div className="text-xs font-medium text-indigo-600/70 mt-1">Verified via PDF extraction</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs font-medium text-indigo-400 uppercase tracking-wider mb-1">Total Duty Paid</div>
                            <div className="text-lg font-black text-indigo-600">{fmt(l.indents.totalValue)}</div>
                          </div>
                        </div>
                      ) : (
                        <div className="h-20 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center text-sm text-gray-400">
                          No Indents uploaded today.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Closing Stock Summary */}
                  <div>
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                       Physical Closing Stock
                    </h3>
                    
                    {!l.hasClosingStock ? (
                       <div className="h-full min-h-[200px] border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center text-sm text-gray-400">
                         Closing stock was not entered for this date.
                       </div>
                    ) : (
                      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                              <th className="text-left px-4 py-2 font-semibold text-gray-600">Category</th>
                              <th className="text-right px-4 py-2 font-semibold text-gray-600">Total Btls</th>
                              <th className="text-right px-4 py-2 font-semibold text-gray-600">System Value</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {Object.entries(l.closingStock).map(([cat, stats]) => (
                              <tr key={cat}>
                                <td className="px-4 py-2 font-medium text-gray-700">{cat}</td>
                                <td className="px-4 py-2 text-right text-gray-600">{stats.totalBottles}</td>
                                <td className="px-4 py-2 text-right text-gray-400">{fmt(stats.value)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-between items-center">
                          <span className="text-xs text-gray-500">Need full breakdown? (Brand x Size)</span>
                          <button onClick={() => downloadStockSheet(l.sessionId)} disabled={downloading === l.sessionId}
                            className="text-sm font-semibold text-white bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
                            {downloading === l.sessionId ? 'Exporting...' : 'Export Full Excel'}
                          </button>
                        </div>
                      </div>
                    )}
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
