'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type StockItem = {
  id:           number
  productName:  string
  category:     string
  sizeMl:       number
  bottlesPerCase: number
  cases:        number
  bottles:      number
  totalBottles: number
}

export default function OpeningStockPage() {
  const router = useRouter()
  const [stock,   setStock]   = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [hideZero, setHideZero] = useState(false)

  useEffect(() => {
    fetch('/api/inventory/opening')
      .then(r => r.json())
      .then(data => { setStock(data); setLoading(false) })
  }, [])

  const filtered = stock.filter(s => {
    const matchSearch = s.productName.toLowerCase().includes(search.toLowerCase()) ||
                        s.category.toLowerCase().includes(search.toLowerCase())
    const matchZero   = hideZero ? s.totalBottles > 0 : true
    return matchSearch && matchZero
  })

  // Group by category
  const grouped = filtered.reduce<Record<string, StockItem[]>>((acc, s) => {
    if (!acc[s.category]) acc[s.category] = []
    acc[s.category].push(s)
    return acc
  }, {})

  const totalBottles = filtered.reduce((s, r) => s + r.totalBottles, 0)
  const nonZeroCount = stock.filter(s => s.totalBottles > 0).length

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 text-sm">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Today's Opening Stock</h1>
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 p-5 rounded-2xl flex items-start gap-3">
        <svg className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8V7a4 4 0 00-8 0v4h8z"/>
        </svg>
        <div className="flex-1">
          <h2 className="font-bold text-blue-900 text-sm mb-1">Fixed Database Ledger — Full Inventory Snapshot</h2>
          <p className="text-blue-800 text-xs leading-relaxed">
            Showing all {stock.length} products. {nonZeroCount} have opening stock (yesterday's closing rolled forward).
            Products showing 0 were not in stock when the day started.
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-black text-blue-700">{totalBottles.toLocaleString('en-IN')}</div>
          <div className="text-xs text-blue-500 font-semibold">total bottles</div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by product or category…"
          className="px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none w-80 shadow-sm"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideZero}
            onChange={e => setHideZero(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Hide zero-stock items
        </label>
        <div className="ml-auto text-sm text-gray-400">
          {filtered.length} of {stock.length} items
        </div>
      </div>

      {/* Grouped tables */}
      {Object.keys(grouped).length === 0 ? (
        <div className="p-10 border-2 border-dashed border-gray-200 rounded-xl text-center text-gray-400 bg-white">
          No items match your search.
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([category, items]) => {
            const catTotal = items.reduce((s, r) => s + r.totalBottles, 0)
            return (
              <div key={category} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                {/* Category header */}
                <div className="bg-gray-50 px-6 py-2.5 border-b border-gray-200 flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{category}</span>
                  <span className="text-xs text-gray-400 font-semibold">{catTotal.toLocaleString('en-IN')} btls · {items.length} SKUs</span>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50/50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-6 py-2.5 font-semibold text-gray-500">Product</th>
                      <th className="text-center px-4 py-2.5 font-semibold text-gray-500">Size</th>
                      <th className="text-center px-4 py-2.5 font-semibold text-gray-500">Cases</th>
                      <th className="text-center px-4 py-2.5 font-semibold text-gray-500">Loose Btls</th>
                      <th className="text-right px-6 py-2.5 font-bold text-gray-700">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {items.map(s => (
                      <tr
                        key={s.id}
                        className={`transition-colors ${
                          s.totalBottles > 0
                            ? 'hover:bg-blue-50/30'
                            : 'opacity-40 hover:opacity-60'
                        }`}
                      >
                        <td className="px-6 py-2.5">
                          <span className="font-medium text-gray-900">{s.productName}</span>
                        </td>
                        <td className="px-4 py-2.5 text-center text-gray-500">{s.sizeMl}ml</td>
                        <td className="px-4 py-2.5 text-center text-gray-600">{s.cases}</td>
                        <td className="px-4 py-2.5 text-center text-gray-600">{s.bottles}</td>
                        <td className="px-6 py-2.5 text-right">
                          {s.totalBottles > 0 ? (
                            <span className="font-black text-blue-700 text-base">{s.totalBottles}</span>
                          ) : (
                            <span className="text-gray-300 font-semibold">0</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-blue-50/30 border-t border-blue-100">
                      <td className="px-6 py-2 font-bold text-blue-700" colSpan={4}>
                        {category} Total
                      </td>
                      <td className="px-6 py-2 text-right font-black text-blue-700">
                        {catTotal.toLocaleString('en-IN')}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
          })}

          {/* Grand total */}
          <div className="bg-slate-800 text-white rounded-xl px-6 py-3 flex items-center justify-between">
            <span className="font-bold text-sm">Grand Total Opening Stock</span>
            <span className="font-black text-xl">{totalBottles.toLocaleString('en-IN')} bottles</span>
          </div>
        </div>
      )}
    </div>
  )
}
