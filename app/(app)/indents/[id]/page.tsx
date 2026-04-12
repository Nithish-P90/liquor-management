'use client'
import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'

export default function IndentDetailPage() {
  const router = useRouter()
  const { id } = useParams()
  const [indent, setIndent] = useState<any>(null)
  const [receiveQtys, setReceiveQtys] = useState<Record<number, { casesReceived: number; bottlesReceived: number }>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notes, setNotes] = useState('')

  useEffect(() => {
    fetch('/api/indents').then(r => r.json()).then(data => {
      const found = data.find((d: any) => d.id === parseInt(id as string))
      if (found) {
        setIndent(found)
        const init: Record<number, { casesReceived: number; bottlesReceived: number }> = {}
        found.items.forEach((item: any) => {
          init[item.id] = { casesReceived: item.cnfCases, bottlesReceived: item.cnfBottles }
        })
        setReceiveQtys(init)
      }
      setLoading(false)
    })
  }, [id])

  async function receiveStock() {
    setSaving(true)
    const items = indent.items.map((item: any) => ({
      indentItemId: item.id,
      productSizeId: item.productSizeId,
      casesReceived: receiveQtys[item.id]?.casesReceived ?? 0,
      bottlesReceived: receiveQtys[item.id]?.bottlesReceived ?? 0,
      bottlesPerCase: item.productSize?.bottlesPerCase ?? 12,
    }))
    await fetch('/api/indents/receive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ indentId: indent.id, items, notes }),
    })
    setSaving(false)
    router.push('/indents')
  }

  if (loading) return <div className="p-8 flex items-center justify-center"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" /></div>
  if (!indent) return <div className="p-8 text-gray-400">Indent not found</div>

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">← Back</button>
        <h1 className="text-2xl font-bold text-gray-900">Receive Stock — {indent.indentNumber}</h1>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm">
        <div className="grid grid-cols-3 gap-4">
          <div><span className="text-gray-500">Invoice:</span> <strong>{indent.invoiceNumber}</strong></div>
          <div><span className="text-gray-500">Date:</span> <strong>{new Date(indent.indentDate).toLocaleDateString('en-IN')}</strong></div>
          <div><span className="text-gray-500">Status:</span> <strong className="text-blue-700">{indent.status}</strong></div>
        </div>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-sm text-yellow-800">
        Quantities pre-filled from CNF (confirmed) amounts. Adjust if delivery was short.
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Product</th>
              <th className="text-center px-4 py-3 font-semibold text-green-600">CNF Cases</th>
              <th className="text-center px-4 py-3 font-semibold text-green-600">CNF Btls</th>
              <th className="text-center px-4 py-3 font-semibold text-blue-600">Received Cases</th>
              <th className="text-center px-4 py-3 font-semibold text-blue-600">Received Btls</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-600">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {indent.items.map((item: any) => (
              <tr key={item.id} className={item.isRationed ? 'bg-red-50' : ''}>
                <td className="px-4 py-2.5 font-medium text-gray-800">
                  {item.product?.name}
                  {item.isRationed && <span className="ml-2 text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Rationed</span>}
                </td>
                <td className="px-4 py-2.5 text-center text-green-700 font-semibold">{item.cnfCases}</td>
                <td className="px-4 py-2.5 text-center text-green-700 font-semibold">{item.cnfBottles}</td>
                <td className="px-4 py-2.5 text-center">
                  <input type="number" min="0" value={receiveQtys[item.id]?.casesReceived ?? 0}
                    onChange={e => setReceiveQtys({ ...receiveQtys, [item.id]: { ...receiveQtys[item.id], casesReceived: +e.target.value } })}
                    className="w-20 text-center px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none" />
                </td>
                <td className="px-4 py-2.5 text-center">
                  <input type="number" min="0" value={receiveQtys[item.id]?.bottlesReceived ?? 0}
                    onChange={e => setReceiveQtys({ ...receiveQtys, [item.id]: { ...receiveQtys[item.id], bottlesReceived: +e.target.value } })}
                    className="w-20 text-center px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none" />
                </td>
                <td className="px-4 py-2.5 text-right text-gray-700">₹{Number(item.cnfAmount).toLocaleString('en-IN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          placeholder="e.g. Short delivery on 3 items, delivery driver: Ramu"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
      </div>

      <div className="flex justify-end">
        <button onClick={receiveStock} disabled={saving}
          className="px-8 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 disabled:opacity-50 text-lg transition-colors">
          {saving ? 'Saving...' : 'Confirm Stock Received'}
        </button>
      </div>
    </div>
  )
}
