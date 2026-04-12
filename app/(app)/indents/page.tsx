'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function IndentsPage() {
  const router = useRouter()
  const [indents, setIndents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/indents').then(r => r.json()).then(d => { setIndents(d); setLoading(false) })
  }, [])

  const statusColor: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-700',
    PARTIAL: 'bg-blue-100 text-blue-700',
    FULLY_RECEIVED: 'bg-green-100 text-green-700',
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Indent Orders</h1>
        <button onClick={() => router.push('/indents/upload')} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors">
           Upload Indent PDF
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : indents.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-5xl mb-4"></div>
          <p className="text-lg font-medium">No indents uploaded yet</p>
          <p className="text-sm mt-1">Upload a KSBCL indent PDF to get started</p>
          <button onClick={() => router.push('/indents/upload')} className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
            Upload Now
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {indents.map(indent => (
            <div key={indent.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold text-gray-900">{indent.indentNumber}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[indent.status]}`}>
                      {indent.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    Invoice: {indent.invoiceNumber} &bull; {indent.retailerName} (#{indent.retailerId})
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Date: {new Date(indent.indentDate).toLocaleDateString('en-IN')} &bull;
                    Uploaded: {new Date(indent.createdAt).toLocaleDateString('en-IN')}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-gray-900">
                    ₹{indent.items.reduce((s: number, i: any) => s + Number(i.cnfAmount), 0).toLocaleString('en-IN')}
                  </div>
                  <div className="text-xs text-gray-400">{indent.items.length} items</div>
                </div>
              </div>

              {/* Summary */}
              <div className="mt-4 grid grid-cols-3 gap-4 text-sm border-t pt-4">
                <div>
                  <div className="text-gray-500">Indent Amount</div>
                  <div className="font-semibold">₹{indent.items.reduce((s: number, i: any) => s + Number(i.indentAmount), 0).toLocaleString('en-IN')}</div>
                </div>
                <div>
                  <div className="text-gray-500">CNF Amount</div>
                  <div className="font-semibold text-green-700">₹{indent.items.reduce((s: number, i: any) => s + Number(i.cnfAmount), 0).toLocaleString('en-IN')}</div>
                </div>
                <div>
                  <div className="text-gray-500">Receipts</div>
                  <div className="font-semibold">{indent.receipts.length} received</div>
                </div>
              </div>

              {/* Items preview */}
              <div className="mt-3 max-h-32 overflow-y-auto">
                <div className="flex flex-wrap gap-1">
                  {indent.items.map((item: any) => (
                    <span key={item.id} className={`text-xs px-2 py-0.5 rounded border ${item.isRationed ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                      {item.product?.name ?? item.id} {item.isRationed ? '(Rationed)' : ''}
                    </span>
                  ))}
                </div>
              </div>

              {indent.status !== 'FULLY_RECEIVED' && (
                <div className="mt-4">
                  <button onClick={() => router.push(`/indents/${indent.id}`)}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
                     Receive Stock
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
