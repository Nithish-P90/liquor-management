'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function InventoryPage() {
  const router = useRouter()
  const [stock, setStock] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sessions, setSessions] = useState<any[]>([])

  useEffect(() => {
    Promise.all([
      fetch('/api/inventory/current').then(r => r.json()),
      fetch('/api/inventory/sessions').then(r => r.json()),
    ]).then(([s, sess]) => { setStock(s); setSessions(sess); setLoading(false) })
  }, [])

  const filtered = stock
    .filter(s => s.productName.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (b.currentStock > 0 ? 1 : 0) - (a.currentStock > 0 ? 1 : 0) || b.currentStock - a.currentStock)

  const lowStock = stock.filter(s => s.currentStock >= 0 && s.currentStock <= 6).length
  const currentSession = sessions[0]

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Inventory Overview</h1>
        <div className="flex gap-3">
          <button onClick={() => router.push('/inventory/opening')} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">Opening Stock</button>
          <button onClick={() => router.push('/inventory/closing')} className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700">Closing Stock</button>
          <button onClick={() => router.push('/inventory/reconcile')} className="px-4 py-2 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700">Reconcile</button>
        </div>
      </div>

      {/* Session Info */}
      {currentSession && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-blue-800">Current Period: </span>
              <span className="text-sm text-blue-700">
                {new Date(currentSession.periodStart).toLocaleDateString('en-IN')} — {new Date(currentSession.periodEnd).toLocaleDateString('en-IN')}
              </span>
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-red-600 font-medium">⚠️ {lowStock} low stock items</span>
              <span className="text-gray-500">Session #{currentSession.id}</span>
            </div>
          </div>
        </div>
      )}

      {!currentSession && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <p className="text-yellow-800 font-medium">No active inventory session. <button onClick={() => router.push('/inventory/opening')} className="underline text-blue-600">Start a new session</button></p>
        </div>
      )}

      <div className="flex gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search products..." className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-80" />
        <span className="text-sm text-gray-500 self-center">{filtered.length} products</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Product</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Category</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Size</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Current Stock</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Selling Price</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(s => (
                <tr key={s.id} className={`hover:bg-gray-50 ${s.currentStock <= 0 ? 'bg-red-50' : s.currentStock <= 6 ? 'bg-yellow-50' : ''}`}>
                  <td className="px-4 py-2.5 font-medium text-gray-900">{s.productName}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{s.category}</td>
                  <td className="px-4 py-2.5 text-center text-gray-600">{s.sizeMl}ml</td>
                  <td className="px-4 py-2.5 text-center font-bold">
                    <span className={s.currentStock <= 0 ? 'text-red-600' : s.currentStock <= 6 ? 'text-yellow-600' : 'text-green-700'}>
                      {s.cases} cases, {s.bottles} bottles
                    </span>
                    <div className="mt-1 text-xs font-normal text-gray-400">{s.currentStock} bottles total</div>
                  </td>
                  <td className="px-4 py-2.5 text-center text-gray-700">₹{Number(s.sellingPrice).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-2.5 text-center">
                    {s.currentStock <= 0 ? (
                      <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">OUT OF STOCK</span>
                    ) : s.currentStock <= 6 ? (
                      <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">LOW</span>
                    ) : (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
