'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ClosingStockPage() {
  const router = useRouter()
  const [products, setProducts] = useState<any[]>([])
  const [entries, setEntries] = useState<Record<number, { cases: number; bottles: number }>>({})
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [search, setSearch] = useState('')
  const [currentStock, setCurrentStock] = useState<Record<number, number>>({})

  useEffect(() => {
    Promise.all([
      fetch('/api/products').then(r => r.json()),
      fetch('/api/inventory/sessions').then(r => r.json()),
      fetch('/api/inventory/current').then(r => r.json()),
    ]).then(([prods, sess, stock]) => {
      setProducts(prods)
      if (sess[0]) setSessionId(sess[0].id)
      const init: Record<number, { cases: number; bottles: number }> = {}
      const stockMap: Record<number, number> = {}
      prods.forEach((p: any) => p.sizes.forEach((s: any) => { init[s.id] = { cases: 0, bottles: 0 } }))
      stock.forEach((s: any) => { stockMap[s.id] = s.currentStock })
      setEntries(init); setCurrentStock(stockMap)
    })
  }, [])

  async function saveClosingStock() {
    if (!sessionId) { alert('No active session — please create opening stock first'); return }
    setLoading(true)
    const validEntries = Object.entries(entries)
      .map(([productSizeId, v]) => ({ productSizeId: parseInt(productSizeId), ...v }))
    await fetch('/api/inventory/closing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, entries: validEntries }),
    })
    setLoading(false); setSaved(true)
    setTimeout(() => router.push('/inventory/reconcile'), 1500)
  }

  const allSizes = products.flatMap(p => p.sizes.map((s: any) => ({
    ...s, productName: p.name, category: p.category
  }))).filter(s => !search || s.productName.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">← Back</button>
        <h1 className="text-2xl font-bold text-gray-900">Closing Stock Entry (Physical Count)</h1>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-800">
        <strong>Instructions:</strong> Count every bottle physically on the shelf/storage. Enter actual count below.
        System will compare with expected and generate variance report.
      </div>

      {saved && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-green-800 font-semibold text-center">
           Closing stock saved! Running reconciliation...
        </div>
      )}

      <div className="flex gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search products..." className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-80" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Product</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-600">Size</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-600 text-blue-600">Expected</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-600">Cases (Physical)</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-600">Bottles (Physical)</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-600">Total</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-600">Variance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {allSizes.map(s => {
              const e = entries[s.id] ?? { cases: 0, bottles: 0 }
              const total = (e.cases * s.bottlesPerCase) + e.bottles
              const expected = currentStock[s.id] ?? 0
              const expectedCases = Math.floor(expected / s.bottlesPerCase)
              const expectedBottles = expected % s.bottlesPerCase
              const variance = total - expected
              return (
                <tr key={s.id} className={`hover:bg-gray-50 ${variance < -2 ? 'bg-red-50' : variance < 0 ? 'bg-yellow-50' : ''}`}>
                  <td className="px-4 py-2 font-medium text-gray-800">{s.productName}</td>
                  <td className="px-4 py-2 text-center text-gray-500">{s.sizeMl}ml</td>
                  <td className="px-4 py-2 text-center font-semibold text-blue-600">
                    {expectedCases}c {expectedBottles}b
                    <div className="text-[11px] font-normal text-gray-400">{expected} bottles total</div>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <input type="number" min="0" value={e.cases}
                      onChange={ev => setEntries({ ...entries, [s.id]: { ...e, cases: parseInt(ev.target.value) || 0 } })}
                      className="w-20 text-center px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none" />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <input type="number" min="0" value={e.bottles}
                      onChange={ev => setEntries({ ...entries, [s.id]: { ...e, bottles: parseInt(ev.target.value) || 0 } })}
                      className="w-20 text-center px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none" />
                  </td>
                  <td className="px-4 py-2 text-center font-semibold">{total}</td>
                  <td className="px-4 py-2 text-center font-bold">
                    {variance !== 0 && (
                      <span className={variance < 0 ? 'text-red-600' : 'text-green-600'}>
                        {variance > 0 ? '+' : ''}{variance}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <button onClick={saveClosingStock} disabled={loading || !sessionId}
          className="px-8 py-3 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 transition-colors disabled:opacity-50 text-lg">
          {loading ? 'Saving...' : 'Save & Run Reconciliation'}
        </button>
      </div>
    </div>
  )
}
