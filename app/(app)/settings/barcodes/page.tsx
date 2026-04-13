'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function BarcodeImporterPage() {
  const router = useRouter()
  const [csvData, setCsvData] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleImport() {
    if (!csvData) return
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/admin/products/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvData }),
      })
      const data = await res.json()
      if (res.ok) {
        setResult(data.message)
      } else {
        setError(data.error)
      }
    } catch {
      setError('An error occurred during import')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">← Back</button>
        <h1 className="text-2xl font-bold text-gray-900">Master Barcode Importer</h1>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">CSV Bulk Import</h2>
          <span className="text-[10px] bg-slate-100 px-2 py-1 rounded text-slate-500 font-bold uppercase">Admin Only</span>
        </div>

        <p className="text-sm text-gray-500 leading-relaxed">
          Paste the product data provided by your manufacturer or depot. The system will automatically update existing barcodes or create new entries based on the <strong>ItemCode</strong> and <strong>Size</strong>.
        </p>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 font-mono text-[11px] text-slate-600">
          <strong>Required Format (with header):</strong><br />
          itemCode, sizeMl, name, barcode, price, bottlesPerCase<br />
          1024, 750, "Signature Premier Whiskey", 89012345678, 1200, 12
        </div>

        <textarea
          value={csvData}
          onChange={(e) => setCsvData(e.target.value)}
          placeholder="itemCode, sizeMl, name, barcode..."
          className="w-full h-80 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none transition-all"
        />

        <div className="flex items-center justify-between pt-2">
          <div className="text-[11px] text-gray-400">
            {csvData.split('\n').filter(l => l.trim()).length} rows detected
          </div>
          <button
            onClick={handleImport}
            disabled={loading || !csvData}
            className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 transition-all shadow-lg active:scale-95"
          >
            {loading ? 'Processing...' : 'Run Import Now'}
          </button>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm font-medium">
            ⚠️ {error}
          </div>
        )}

        {result && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm font-medium">
            ✅ {result}
          </div>
        )}
      </div>

      {/* Security Warning */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-4">
        <div className="text-2xl">⚠️</div>
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-amber-800">Precise Matching Enabled</h3>
          <p className="text-[12px] text-amber-900/70">
            This tool matches products using their <strong>ItemCode</strong>. Ensure the item codes in your file exactly match the ones in your KSBCL indents to prevent duplicate product entries.
          </p>
        </div>
      </div>
    </div>
  )
}
