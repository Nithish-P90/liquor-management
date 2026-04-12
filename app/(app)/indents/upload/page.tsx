'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

type ParsedIndentItem = {
  srNo: number
  itemName: string
  itemCode: string
  ratePerCase: number
  indentCases: number
  indentBottles: number
  indentAmount: number
  cnfCases: number
  cnfBottles: number
  cnfAmount: number
  isRationed: boolean
  productId?: number
}

type ParsedIndentPreview = {
  header: {
    indentNumber: string
    invoiceNumber: string
    retailerId: string
    retailerName: string
    indentDate: string
    rationedCount: number
  }
  items: ParsedIndentItem[]
  totals: {
    indentCases: number
    indentBottles: number
    indentAmount: number
    cnfCases: number
    cnfBottles: number
    cnfAmount: number
  }
}

type UploadResponse = {
  parsed?: ParsedIndentPreview
  pdfPath?: string
  error?: string
}

export default function IndentUploadPage() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedIndentPreview | null>(null)
  const [pdfPath, setPdfPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')

  async function readJsonResponse(res: Response): Promise<UploadResponse> {
    const text = await res.text()
    if (!text) return {}

    try {
      return JSON.parse(text) as UploadResponse
    } catch {
      return { error: text }
    }
  }

  async function handleUpload() {
    if (!file) return
    setLoading(true); setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/indents/upload', { method: 'POST', body: formData })
      const data = await readJsonResponse(res)
      if (!res.ok) { setError(data.error ?? 'Upload failed'); return }
      if (!data.parsed || !data.pdfPath) {
        setError('Upload response was incomplete. Please try again.')
        return
      }
      setParsed(data.parsed); setPdfPath(data.pdfPath)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm() {
    if (!parsed) return
    setConfirming(true)
    const res = await fetch('/api/indents/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ header: parsed.header, items: parsed.items, pdfPath }),
    })
    setConfirming(false)
    if (res.ok) router.push('/indents')
    else setError('Failed to save indent')
  }

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">← Back</button>
        <h1 className="text-2xl font-bold text-gray-900">Upload Indent PDF</h1>
      </div>

      {/* Upload Zone */}
      {!parsed && (
        <div className="bg-white rounded-xl border-2 border-dashed border-gray-300 p-10 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </div>
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Upload KSBCL Indent PDF</h2>
          <p className="text-sm text-gray-400 mb-6">System will automatically extract all line items, quantities, rates, and rationed items</p>
          <input type="file" accept=".pdf" onChange={e => setFile(e.target.files?.[0] ?? null)}
            className="hidden" id="pdf-upload" />
          <label htmlFor="pdf-upload" className="inline-block px-6 py-2.5 bg-gray-100 text-gray-700 rounded-lg cursor-pointer hover:bg-gray-200 font-medium mb-4">
            Choose PDF File
          </label>
          {file && (
            <div className="mt-2">
              <p className="text-sm text-green-600 font-medium">✓ {file.name}</p>
              <button onClick={handleUpload} disabled={loading}
                className="mt-4 px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {loading ? 'Parsing PDF...' : 'Parse & Preview'}
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-600">{error}</div>
      )}

      {/* Parsed Preview */}
      {parsed && (
        <div className="space-y-4">
          {/* Header Info */}
          <div className="bg-green-50 border border-green-200 rounded-xl p-5">
            <h3 className="font-bold text-green-800 mb-3">PDF Parsed Successfully</h3>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="text-gray-500">Indent No:</span> <strong>{parsed.header.indentNumber}</strong></div>
              <div><span className="text-gray-500">Invoice No:</span> <strong>{parsed.header.invoiceNumber}</strong></div>
              <div><span className="text-gray-500">Retailer ID:</span> <strong>{parsed.header.retailerId}</strong></div>
              <div><span className="text-gray-500">Retailer:</span> <strong>{parsed.header.retailerName}</strong></div>
              <div><span className="text-gray-500">Date:</span> <strong>{parsed.header.indentDate}</strong></div>
              <div><span className="text-gray-500">Rationed Items:</span> <strong className="text-red-600">{parsed.header.rationedCount}</strong></div>
            </div>
          </div>

          {/* Totals */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <div className="text-gray-500 text-sm">Indent Total</div>
              <div className="text-xl font-bold text-gray-900">₹{parsed.totals.indentAmount.toLocaleString('en-IN', {maximumFractionDigits:0})}</div>
              <div className="text-xs text-gray-400">{parsed.totals.indentCases} cases + {parsed.totals.indentBottles} btls</div>
            </div>
            <div className="bg-white rounded-xl border border-green-200 p-4 text-center">
              <div className="text-gray-500 text-sm">CNF (Confirmed)</div>
              <div className="text-xl font-bold text-green-700">₹{parsed.totals.cnfAmount.toLocaleString('en-IN', {maximumFractionDigits:0})}</div>
              <div className="text-xs text-gray-400">{parsed.totals.cnfCases} cases + {parsed.totals.cnfBottles} btls</div>
            </div>
            <div className="bg-white rounded-xl border border-red-100 p-4 text-center">
              <div className="text-gray-500 text-sm">Items Parsed</div>
              <div className="text-xl font-bold text-gray-900">{parsed.items.length}</div>
              <div className="text-xs text-red-500">{parsed.header.rationedCount} rationed</div>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b font-semibold text-gray-700">Line Items</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-gray-500">SR</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-500">Item</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-500">Code</th>
                    <th className="text-right px-3 py-2 font-semibold text-gray-500">Rate/Case</th>
                    <th className="text-center px-3 py-2 font-semibold text-gray-500">Indent CBS</th>
                    <th className="text-center px-3 py-2 font-semibold text-gray-500">Indent Btls</th>
                    <th className="text-right px-3 py-2 font-semibold text-gray-500">Indent Amt</th>
                    <th className="text-center px-3 py-2 font-semibold text-green-600">CNF CBS</th>
                    <th className="text-center px-3 py-2 font-semibold text-green-600">CNF Btls</th>
                    <th className="text-right px-3 py-2 font-semibold text-green-600">CNF Amt</th>
                    <th className="text-center px-3 py-2 font-semibold text-gray-500">Matched</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {parsed.items.map(item => (
                    <tr key={item.srNo} className={item.isRationed ? 'bg-red-50' : ''}>
                      <td className="px-3 py-2 text-gray-400">{item.srNo}</td>
                      <td className="px-3 py-2 font-medium text-gray-800 max-w-[200px] truncate">
                        {item.itemName}
                        {item.isRationed && <span className="ml-1 text-red-500 text-[10px]">[R]</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-500">{item.itemCode}</td>
                      <td className="px-3 py-2 text-right text-gray-700">₹{item.ratePerCase.toLocaleString('en-IN')}</td>
                      <td className="px-3 py-2 text-center">{item.indentCases}</td>
                      <td className="px-3 py-2 text-center">{item.indentBottles}</td>
                      <td className="px-3 py-2 text-right">₹{item.indentAmount.toLocaleString('en-IN', {maximumFractionDigits:0})}</td>
                      <td className="px-3 py-2 text-center font-semibold text-green-700">{item.cnfCases}</td>
                      <td className="px-3 py-2 text-center font-semibold text-green-700">{item.cnfBottles}</td>
                      <td className="px-3 py-2 text-right font-semibold text-green-700">₹{item.cnfAmount.toLocaleString('en-IN', {maximumFractionDigits:0})}</td>
                      <td className="px-3 py-2 text-center">
                        {item.productId ? <span className="text-green-500">✓</span> : <span className="text-yellow-500">New</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => { setParsed(null); setFile(null) }} className="px-6 py-2.5 border border-gray-300 rounded-xl text-gray-600 hover:bg-gray-50">
              Re-upload
            </button>
            <button onClick={handleConfirm} disabled={confirming}
              className="flex-1 py-2.5 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 disabled:opacity-50 transition-colors">
              {confirming ? 'Adding to inventory...' : 'Confirm & Add to Inventory'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
