'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ClosingStockPage() {
  const router = useRouter()
  const [stock, setStock] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/inventory/current')
      .then(r => r.json())
      .then(data => {
        setStock(data)
        setLoading(false)
      })
  }, [])

  const filtered = stock
    .filter(s => s.productName.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (b.currentStock > 0 ? 1 : 0) - (a.currentStock > 0 ? 1 : 0) || b.currentStock - a.currentStock)

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">← Back</button>
        <h1 className="text-2xl font-bold text-gray-900">Live Closing Projection</h1>
      </div>

      <div className="bg-green-50 border border-green-200 p-6 rounded-2xl mb-4 flex items-start gap-3">
        <svg className="w-6 h-6 text-green-600 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <h2 className="font-bold text-green-900 mb-1">Algorithmic Ledger</h2>
          <p className="text-green-800 text-sm leading-relaxed">
            These numbers represent your perfect mathematical Closing Stock (Opening + Indents - Sales). They are strictly calculated in real-time and will be automatically snapshot and carried forward when you run the 1-Click Close End of Day setup.
          </p>
        </div>
      </div>

      <div className="flex gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search items..." className="px-5 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none w-96 shadow-sm" />
      </div>

      {filtered.length === 0 ? (
        <div className="p-10 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center text-gray-400 bg-white">
          No inventory initialization found.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-6 py-4 font-bold text-gray-600 tracking-wider">Product Baseline</th>
                <th className="text-center px-6 py-4 font-bold text-gray-600 tracking-wider">SKU Size</th>
                <th className="text-center px-6 py-4 font-bold text-gray-900 tracking-wider bg-gray-100">Live Formula Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(s => {
                const total = s.currentStock
                const displayCases = Math.floor(total / s.bottlesPerCase)
                const displayLoose = total % s.bottlesPerCase

                return (
                  <tr key={s.id} className="hover:bg-green-50/50 transition-colors">
                    <td className="px-6 py-3">
                      <div className="font-bold text-gray-900">{s.productName}</div>
                      <div className="text-xs text-gray-500 uppercase tracking-widest">{s.category}</div>
                    </td>
                    <td className="px-6 py-4 text-center font-medium text-gray-500">{s.sizeMl}ml</td>
                    <td className="px-6 py-4 text-center">
                      <div className="font-black text-green-700 bg-green-50/50 text-base py-1 px-3 rounded-lg inline-block">
                        {total} btls
                        <span className="text-xs font-semibold text-green-600/70 block uppercase tracking-wider mt-0.5">
                          ({displayCases}C {displayLoose}L)
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
