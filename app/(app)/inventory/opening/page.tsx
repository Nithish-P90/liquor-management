'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function OpeningStockPage() {
  const router = useRouter()
  const [products, setProducts] = useState<any[]>([])
  const [entries, setEntries] = useState<Record<number, { cases: number; bottles: number }>>({})
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [periodStart, setPeriodStart] = useState(new Date().toISOString().slice(0, 10))
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/products').then(r => r.json()).then(data => {
      setProducts(data)
      const init: Record<number, { cases: number; bottles: number }> = {}
      data.forEach((p: any) => p.sizes.forEach((s: any) => { init[s.id] = { cases: 0, bottles: 0 } }))
      setEntries(init)
    })
    fetch('/api/inventory/sessions').then(r => r.json()).then(sess => {
      if (sess[0]) setSessionId(sess[0].id)
    })
  }, [])

  async function createSession() {
    const res = await fetch('/api/inventory/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodStart, periodEnd }),
    })
    const sess = await res.json()
    setSessionId(sess.id)
    return sess.id
  }

  async function saveOpeningStock() {
    setLoading(true)
    let sid = sessionId
    if (!sid) sid = await createSession()

    const validEntries = Object.entries(entries)
      .filter(([, v]) => v.cases > 0 || v.bottles > 0)
      .map(([productSizeId, v]) => ({ productSizeId: parseInt(productSizeId), ...v }))

    await fetch('/api/inventory/opening', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sid, entries: validEntries }),
    })
    setLoading(false); setSaved(true)
    setTimeout(() => router.push('/inventory'), 2000)
  }

  const allSizes = products.flatMap(p => p.sizes.map((s: any) => ({
    ...s, productName: p.name, category: p.category
  }))).filter(s => !search || s.productName.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">← Back</button>
        <h1 className="text-2xl font-bold text-gray-900">Opening Stock Entry</h1>
      </div>

      {saved ? (
        <div className="p-6 bg-green-50 border border-green-200 rounded-xl text-center">
          <div className="text-4xl mb-2"></div>
          <div className="text-green-800 font-bold text-lg">Opening stock saved!</div>
          <div className="text-green-600 text-sm mt-1">Redirecting to inventory...</div>
        </div>
      ) : (
        <>
          {/* Period Setup */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-700 mb-3">Accounting Period</h2>
            <div className="flex gap-4 items-center">
              <div>
                <label className="block text-sm text-gray-600 mb-1">From</label>
                <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">To</label>
                <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              {sessionId && <span className="text-sm text-green-600 font-medium">✓ Using session #{sessionId}</span>}
            </div>
          </div>

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
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Cases</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Loose Bottles</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Total Bottles</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {allSizes.map(s => {
                  const e = entries[s.id] ?? { cases: 0, bottles: 0 }
                  const total = (e.cases * s.bottlesPerCase) + e.bottles
                  return (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-800">{s.productName}</td>
                      <td className="px-4 py-2 text-center text-gray-500">{s.sizeMl}ml</td>
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
                      <td className="px-4 py-2 text-center font-semibold text-gray-700">{total}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <button onClick={saveOpeningStock} disabled={loading}
              className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 text-lg">
              {loading ? 'Saving...' : 'Save Opening Stock'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
