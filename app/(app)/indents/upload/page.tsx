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
  parseError?: number
  parseConfidence?: boolean
  productId?: number
  productSizeId?: number
  sizeMl: number
  bottlesPerCase: number
  debugRawLine?: string
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

type EditRow = { srNo: number; cnfCases: number; cnfBottles: number }

export default function IndentUploadPage() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedIndentPreview | null>(null)
  const [editRows, setEditRows] = useState<EditRow[]>([])
  const [pdfPath, setPdfPath] = useState('')
  const [ocrText, setOcrText] = useState('')
  const [showOcr, setShowOcr] = useState(false)
  const [reocring, setReocring] = useState(false)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [expandedSr, setExpandedSr] = useState<number | null>(null)

  function initEditRows(items: ParsedIndentItem[]) {
    setEditRows(items.map(i => ({ srNo: i.srNo, cnfCases: i.cnfCases, cnfBottles: i.cnfBottles })))
  }

  function updateEdit(srNo: number, field: 'cnfCases' | 'cnfBottles', raw: string) {
    const val = Math.max(0, parseInt(raw) || 0)
    setEditRows(prev => prev.map(r => r.srNo === srNo ? { ...r, [field]: val } : r))
  }

  function getEdit(srNo: number): EditRow {
    return editRows.find(r => r.srNo === srNo) ?? { srNo, cnfCases: 0, cnfBottles: 0 }
  }

  function totalBottles(item: ParsedIndentItem, edit: EditRow) {
    return edit.cnfCases * item.bottlesPerCase + edit.cnfBottles
  }

  // Rate check: how far is the computed value from the PDF's cnfAmount?
  function rateCheck(item: ParsedIndentItem, edit: EditRow): { ok: boolean; delta: number } {
    if (!item.ratePerCase || !item.bottlesPerCase) return { ok: true, delta: 0 }
    const computed = (edit.cnfCases * item.ratePerCase) + (edit.cnfBottles * item.ratePerCase / item.bottlesPerCase)
    const delta = Math.abs(computed - item.cnfAmount)
    // Allow 2% tolerance (rounding in KSBCL)
    return { ok: delta <= Math.max(2, item.ratePerCase * 0.02), delta: Math.round(delta) }
  }

  function needsReview(item: ParsedIndentItem, edit: EditRow) {
    // Bottles show 0 but the PDF amount says something was paid → parser likely wrong
    return totalBottles(item, edit) === 0 && item.cnfAmount > 0
  }

  async function handleUpload() {
    if (!file) return
    setLoading(true); setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/indents/upload', { method: 'POST', body: formData })
      const text = await res.text()
      if (!text) { setError('Empty response from server'); return }
      const data = JSON.parse(text)
      if (!res.ok) { setError(data.error ?? 'Upload failed'); if (data.ocrText) setOcrText(data.ocrText); return }
      if (!data.parsed || !data.pdfPath) { setError('Incomplete response. Try again.'); if (data.ocrText) setOcrText(data.ocrText); return }
      setParsed(data.parsed)
      setPdfPath(data.pdfPath)
      setOcrText(data.ocrText ?? '')
      initEditRows(data.parsed.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm() {
    if (!parsed) return
    setConfirming(true)
    // Merge parsed items with user-edited cnfCases / cnfBottles
    const mergedItems = parsed.items.map(item => {
      const edit = getEdit(item.srNo)
      return { ...item, cnfCases: edit.cnfCases, cnfBottles: edit.cnfBottles }
    })
    const res = await fetch('/api/indents/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ header: parsed.header, items: mergedItems, pdfPath }),
    })
    setConfirming(false)
    if (res.ok) router.push('/indents')
    else setError('Failed to save indent')
  }

  // Live totals from edited rows
  const liveTotals = parsed ? parsed.items.reduce((acc, item) => {
    const edit = getEdit(item.srNo)
    return {
      cases: acc.cases + edit.cnfCases,
      bottles: acc.bottles + edit.cnfBottles,
      totalBottles: acc.totalBottles + totalBottles(item, edit),
    }
  }, { cases: 0, bottles: 0, totalBottles: 0 }) : null

  const reviewCount = parsed ? parsed.items.filter(i => needsReview(i, getEdit(i.srNo))).length : 0

  return (
    <div className="p-6 space-y-5 max-w-7xl">
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">← Back</button>
        <h1 className="text-2xl font-bold text-gray-900">Upload Indent PDF</h1>
      </div>

      {/* Upload Zone */}
      {!parsed && (
        <div className="bg-white rounded-xl border-2 border-dashed border-gray-300 p-10 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
            <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Upload KSBCL Indent PDF</h2>
          <p className="text-sm text-gray-400 mb-6">System extracts all line items, quantities, rates, and rationed items</p>
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

          {/* Review alert */}
          {reviewCount > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-3">
              <span className="text-amber-500 text-lg font-bold mt-0.5">⚠</span>
              <div>
                <p className="font-bold text-amber-800">{reviewCount} row{reviewCount > 1 ? 's' : ''} need review</p>
                <p className="text-amber-700 text-sm">These rows show 0 bottles but have a non-zero CNF amount — the parser may have got the quantity wrong. Correct the cases/bottles before confirming.</p>
              </div>
            </div>
          )}

          {/* Totals */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <div className="text-gray-500 text-xs mb-1">Indent Total</div>
              <div className="text-lg font-bold text-gray-900">₹{parsed.totals.indentAmount.toLocaleString('en-IN', {maximumFractionDigits:0})}</div>
              <div className="text-xs text-gray-400">{parsed.totals.indentCases}cs + {parsed.totals.indentBottles}btl</div>
            </div>
            <div className="bg-white rounded-xl border border-green-200 p-4 text-center">
              <div className="text-gray-500 text-xs mb-1">CNF (PDF)</div>
              <div className="text-lg font-bold text-green-700">₹{parsed.totals.cnfAmount.toLocaleString('en-IN', {maximumFractionDigits:0})}</div>
              <div className="text-xs text-gray-400">{parsed.totals.cnfCases}cs + {parsed.totals.cnfBottles}btl</div>
            </div>
            <div className="bg-blue-50 rounded-xl border border-blue-200 p-4 text-center">
              <div className="text-blue-600 text-xs mb-1 font-semibold">You Are Receiving</div>
              <div className="text-lg font-bold text-blue-700">{liveTotals?.totalBottles.toLocaleString('en-IN')} bottles</div>
              <div className="text-xs text-blue-500">{liveTotals?.cases}cs + {liveTotals?.bottles} loose</div>
            </div>
            <div className="bg-white rounded-xl border border-red-100 p-4 text-center">
              <div className="text-gray-500 text-xs mb-1">Items</div>
              <div className="text-lg font-bold text-gray-900">{parsed.items.length}</div>
              <div className="text-xs text-red-500">{parsed.header.rationedCount} rationed · {reviewCount} to review</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b">
                  <span className="font-semibold text-gray-700">Line Items</span>
                  <span className="ml-3 text-xs text-gray-400">CNF cases and bottles are editable — correct any errors before confirming</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left px-3 py-2 text-gray-500 font-semibold">SR</th>
                        <th className="text-left px-3 py-2 text-gray-500 font-semibold">Item</th>
                        <th className="text-left px-3 py-2 text-gray-500 font-semibold">Code</th>
                        <th className="text-right px-3 py-2 text-gray-500 font-semibold">Rate/Case</th>
                        <th className="text-center px-3 py-2 text-gray-400 font-semibold">Indent CBS</th>
                        <th className="text-center px-3 py-2 text-gray-400 font-semibold">Indent Btl</th>
                        <th className="text-right px-3 py-2 text-gray-400 font-semibold">Indent ₹</th>
                        <th className="text-center px-3 py-2 text-green-700 font-bold">CNF Cases</th>
                        <th className="text-center px-3 py-2 text-green-700 font-bold">CNF Btls</th>
                        <th className="text-center px-3 py-2 text-blue-700 font-bold">Total Btls</th>
                        <th className="text-center px-3 py-2 text-gray-500 font-semibold">Rate ✓</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.items.map(item => {
                        const edit = getEdit(item.srNo)
                        const btls = totalBottles(item, edit)
                        const check = rateCheck(item, edit)
                        const lowConfidence = item.parseConfidence === false || (item.parseError ?? 0) > Math.max(1, item.ratePerCase * 0.02) * 3
                        const review = needsReview(item, edit) || lowConfidence
                        const isExpanded = expandedSr === item.srNo

                        return (
                          <>
                            <tr
                              key={item.srNo}
                              className={[
                                'border-b border-gray-50',
                                review ? 'bg-amber-50' : item.isRationed ? 'bg-red-50' : '',
                              ].join(' ')}
                            >
                              <td className="px-3 py-2 text-gray-400">{item.srNo}</td>
                              <td className="px-3 py-2 max-w-[180px]">
                                <div className="font-medium text-gray-800 truncate">{item.itemName}</div>
                                <div className="text-gray-400 text-[10px]">{item.sizeMl}ml · {item.bottlesPerCase}/cs</div>
                                {item.isRationed && <span className="text-red-500 text-[10px] font-bold">[RATIONED]</span>}
                              </td>
                              <td className="px-3 py-2 font-mono text-gray-500">{item.itemCode}</td>
                              <td className="px-3 py-2 text-right text-gray-700">₹{item.ratePerCase.toLocaleString('en-IN')}</td>
                              <td className="px-3 py-2 text-center text-gray-400">{item.indentCases}</td>
                              <td className="px-3 py-2 text-center text-gray-400">{item.indentBottles}</td>
                              <td className="px-3 py-2 text-right text-gray-400">₹{item.indentAmount.toLocaleString('en-IN', {maximumFractionDigits:0})}</td>

                              {/* Editable CNF Cases */}
                              <td className="px-2 py-1.5 text-center">
                                <input
                                  type="number"
                                  min={0}
                                  value={edit.cnfCases}
                                  onChange={e => updateEdit(item.srNo, 'cnfCases', e.target.value)}
                                  className="w-14 text-center border border-green-300 rounded-lg px-1 py-1 text-green-800 font-bold focus:ring-2 focus:ring-green-400 outline-none bg-white"
                                />
                              </td>

                              {/* Editable CNF Bottles */}
                              <td className="px-2 py-1.5 text-center">
                                <input
                                  type="number"
                                  min={0}
                                  value={edit.cnfBottles}
                                  onChange={e => updateEdit(item.srNo, 'cnfBottles', e.target.value)}
                                  className="w-14 text-center border border-green-300 rounded-lg px-1 py-1 text-green-800 font-bold focus:ring-2 focus:ring-green-400 outline-none bg-white"
                                />
                              </td>

                              {/* Computed total bottles */}
                              <td className="px-3 py-2 text-center">
                                <span className={[
                                  'font-black text-sm',
                                  review ? 'text-amber-600' : btls > 0 ? 'text-blue-700' : 'text-gray-300',
                                ].join(' ')}>
                                  {btls}
                                </span>
                                {review && <div className="text-amber-500 text-[10px] font-bold">REVIEW</div>}
                              </td>

                              {/* Rate check */}
                              <td className="px-3 py-2 text-center">
                                {check.ok ? (
                                  <span className="text-green-500 font-bold">✓</span>
                                ) : (
                                  <span className="text-orange-500 font-bold" title={`₹${check.delta} off`}>⚠ ₹{check.delta}</span>
                                )}
                                {/* Debug toggle */}
                                <button
                                  onClick={() => setExpandedSr(isExpanded ? null : item.srNo)}
                                  className="block mx-auto mt-0.5 text-gray-300 hover:text-gray-500 text-[10px]"
                                  title="Show raw PDF data"
                                >
                                  {isExpanded ? '▲' : '▼'}
                                </button>
                              </td>
                            </tr>

                            {/* Debug row */}
                            {isExpanded && (
                              <tr key={`debug-${item.srNo}`} className="bg-slate-50 border-b border-gray-100">
                                <td colSpan={11} className="px-4 py-3">
                                  <div className="text-[11px] space-y-1.5 text-gray-600">
                                    <div><span className="font-semibold text-gray-400 uppercase tracking-wider">Raw PDF line: </span>
                                      <code className="font-mono bg-slate-100 px-2 py-0.5 rounded text-gray-700">{item.debugRawLine ?? '(not captured)'}</code>
                                    </div>
                                    <div className="flex gap-6">
                                      <span><span className="font-semibold text-gray-400">Detected size:</span> {item.sizeMl}ml</span>
                                      <span><span className="font-semibold text-gray-400">Btl/case used:</span> {item.bottlesPerCase}</span>
                                      <span><span className="font-semibold text-gray-400">PDF CNF amount:</span> ₹{item.cnfAmount.toLocaleString('en-IN', {maximumFractionDigits: 2, minimumFractionDigits: 2})}</span>
                                      <span><span className="font-semibold text-gray-400">Computed value:</span> ₹{((edit.cnfCases * item.ratePerCase) + (edit.cnfBottles * item.ratePerCase / item.bottlesPerCase)).toLocaleString('en-IN', {maximumFractionDigits: 2, minimumFractionDigits: 2})}</span>
                                      {(item.parseError !== undefined) && (
                                        <span className="text-sm text-red-500">Parse error: ₹{Math.round(item.parseError)}</span>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })}
                    </tbody>
                    <tfoot className="bg-blue-50 border-t-2 border-blue-200">
                      <tr>
                        <td colSpan={9} className="px-3 py-2.5 font-bold text-blue-700 text-right">Total bottles being added to inventory:</td>
                        <td className="px-3 py-2.5 text-center font-black text-blue-700 text-base">{liveTotals?.totalBottles.toLocaleString('en-IN')}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>

            {/* PDF Preview Column */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl border border-gray-200 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-gray-700">PDF Preview</div>
                  <div className="text-xs text-gray-400">Compare OCR vs PDF</div>
                </div>
                <div className="h-[680px] border rounded overflow-hidden">
                  <iframe
                    src={`/${pdfPath}`}
                    title="Indent PDF Preview"
                    className="w-full h-full"
                  />
                </div>
                <div className="mt-3 flex gap-3">
                  <a href={`/${pdfPath}`} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline">Open in new tab</a>
                  <a href={`/${pdfPath}`} download className="text-sm text-gray-600 hover:underline">Download PDF</a>
                  <button
                    onClick={async () => {
                      if (!pdfPath) return
                      setReocring(true); setError('')
                      try {
                        const res = await fetch('/api/indents/reocr', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ pdfPath }),
                        })
                        const data = await res.json()
                        if (!res.ok) { setError(data.error ?? 'Re-OCR failed'); if (data.ocrText) setOcrText(data.ocrText); return }
                        if (data.parsed) {
                          setParsed(data.parsed)
                          setOcrText(data.ocrText ?? '')
                          initEditRows(data.parsed.items)
                        }
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'Re-OCR failed')
                      } finally { setReocring(false) }
                    }}
                    disabled={reocring}
                    className="ml-2 px-3 py-1.5 bg-yellow-500 text-white rounded text-sm disabled:opacity-50 hover:bg-yellow-600"
                  >
                    {reocring ? 'Reprocessing...' : 'Reprocess with OCR'}
                  </button>
                </div>
                {ocrText && (
                  <div className="mt-3 border-t pt-3">
                    <button onClick={() => setShowOcr(s => !s)} className="text-sm text-gray-600 hover:text-gray-800">
                      {showOcr ? 'Hide raw OCR text' : 'Show raw OCR text'}
                    </button>
                    {showOcr && (
                      <div className="mt-2 h-40 overflow-auto bg-slate-50 border rounded p-2 text-xs font-mono whitespace-pre-wrap text-slate-700">
                        {ocrText}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => { setParsed(null); setFile(null); setEditRows([]) }}
              className="px-6 py-2.5 border border-gray-300 rounded-xl text-gray-600 hover:bg-gray-50">
              Re-upload
            </button>
            <button onClick={handleConfirm} disabled={confirming || reviewCount > 0}
              className="flex-1 py-2.5 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 disabled:opacity-50 transition-colors">
              {confirming
                ? 'Adding to inventory...'
                : reviewCount > 0
                  ? `Fix ${reviewCount} flagged row${reviewCount > 1 ? 's' : ''} before confirming`
                  : 'Confirm & Add to Inventory'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
