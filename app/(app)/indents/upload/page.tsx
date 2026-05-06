"use client"

import React, { useRef, useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Upload, AlertTriangle, CheckCircle2, XCircle, AlertCircle, ChevronRight, RotateCcw } from "lucide-react"
import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"

// ── Types ────────────────────────────────────────────────────────────────────

type ParsedItem = {
  srNo: number
  ksbclItemCode: string
  ksbclBaseCode: string
  ksbclSubCode: string
  itemName: string
  rawItemName: string
  sizeMl: number
  bottlesPerCase: number
  ratePerCase: number
  indentCases: number
  indentBottles: number
  indentAmount: number
  cnfCases: number
  cnfBottles: number
  cnfAmount: number
  isRationed: boolean
  isNotAllocated: boolean
}

type MatchResult = {
  parsedItem: ParsedItem
  productSizeId: number | null
  productId: number | null
  confidence: number
  isNewItem: boolean
  matchReason: string
}

type ParseResponse = {
  indentId: number
  parsed: {
    indentNumber: string
    invoiceNumber: string
    retailerName: string
    retailerId: string
    indentDate: string
    totalRationedItems: number
    totalConfirmedValue: number
    totalIndentValue: number
  }
  matches: MatchResult[]
  warnings: string[]
}

type ProductOption = {
  id: number
  sizeMl: number
  product: { name: string; category: string }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function qtyLabel(cases: number, bottles: number): string {
  const parts: string[] = []
  if (cases > 0) parts.push(`${cases} cs`)
  if (bottles > 0) parts.push(`${bottles} bt`)
  return parts.length > 0 ? parts.join(" + ") : "0"
}

function MatchBadge({ match }: { match: MatchResult }) {
  if (match.parsedItem.isNotAllocated) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-500">
        <XCircle size={10} /> Not Allocated
      </span>
    )
  }
  if (match.parsedItem.isRationed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-700">
        <AlertTriangle size={10} /> Rationed
      </span>
    )
  }
  return null
}

function MapBadge({ match }: { match: MatchResult }) {
  if (match.isNewItem) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-rose-600">
        <AlertCircle size={10} /> Unmapped
      </span>
    )
  }
  if (match.matchReason === "exact_ksbcl_code") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-700">
        <CheckCircle2 size={10} /> Exact
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-indigo-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-indigo-700">
      <CheckCircle2 size={10} /> Fuzzy {(match.confidence * 100).toFixed(0)}%
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UploadPage(): JSX.Element {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [result, setResult] = useState<ParseResponse | null>(null)
  const [error, setError] = useState("")
  const [products, setProducts] = useState<ProductOption[]>([])
  const [mappings, setMappings] = useState<Record<number, { sizeId: number; name: string }>>({})

  useEffect(() => {
    fetch("/api/pos/items")
      .then((r) => r.json())
      .then((data: Array<{ kind: string; item: ProductOption }>) =>
        setProducts(data.filter((d) => d.kind === "LIQUOR").map((d) => d.item))
      )
      .catch(() => {})
  }, [])

  async function handleFile(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please select a PDF file")
      return
    }
    setError("")
    setResult(null)
    setParsing(true)
    const fd = new FormData()
    fd.append("pdf", file)
    try {
      const res = await fetch("/api/indents/parse", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Parse failed")
      setResult(data as ParseResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Parse failed")
    } finally {
      setParsing(false)
    }
  }

  function handleDrop(e: React.DragEvent): void {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }


  if (!result) {
    return (
      <PageShell title="Upload KSBCL Indent">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`flex h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-all ${
            dragging ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-400 hover:bg-slate-50"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
          />
          {parsing ? (
            <div className="flex flex-col items-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
              <p className="text-xs font-black uppercase tracking-widest text-slate-400">Parsing PDF…</p>
            </div>
          ) : (
            <>
              <Upload size={28} className="text-slate-300" />
              <p className="text-sm font-bold text-slate-500">Drop KSBCL indent PDF here or click to browse</p>
            </>
          )}
        </div>
        {error && (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">{error}</p>
        )}
      </PageShell>
    )
  }

  const { parsed, matches, warnings, indentId } = result
  const unmappedCount = matches.filter((m) => m.isNewItem && !mappings[indentId]).length
  const rationedCount = matches.filter((m) => m.parsedItem.isRationed).length
  const notAllocatedCount = matches.filter((m) => m.parsedItem.isNotAllocated).length

  // Build a fake map from srNo → indentItemId using position (server returns items in order)
  // We'll use srNo as a proxy key for mappings since we don't have the DB id here
  // Actually the parse response doesn't include IndentItem IDs. We need them for mapping.
  // We'll load the saved indent's items to get the IDs.
  // For now show a "Go to Review" flow since items need to be re-fetched with DB IDs.

  return (
    <PageShell title="Verify Indent">
      {/* Header card */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Indent No", value: parsed.indentNumber },
          { label: "Invoice No", value: parsed.invoiceNumber },
          { label: "Retailer", value: `${parsed.retailerName} (${parsed.retailerId})` },
          { label: "Date", value: parsed.indentDate },
        ].map((f) => (
          <div key={f.label} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{f.label}</p>
            <p className="mt-0.5 text-xs font-bold text-slate-800 truncate">{f.value || "—"}</p>
          </div>
        ))}
      </div>

      {/* Summary pills */}
      <div className="mb-4 flex flex-wrap gap-2">
        <span className="rounded-md bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600">
          {matches.length} items
        </span>
        <span className="rounded-md bg-emerald-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-700">
          CNF ₹{parsed.totalConfirmedValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
        </span>
        {rationedCount > 0 && (
          <span className="rounded-md bg-amber-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-700">
            {rationedCount} rationed
          </span>
        )}
        {notAllocatedCount > 0 && (
          <span className="rounded-md bg-slate-200 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-500">
            {notAllocatedCount} not allocated
          </span>
        )}
        {unmappedCount > 0 && (
          <span className="rounded-md bg-rose-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-rose-600">
            {unmappedCount} unmapped — map in review
          </span>
        )}
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-amber-700">Parse Warnings</p>
          <ul className="space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i} className="text-xs text-amber-700">• {w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Items table */}
      <div className="overflow-x-auto rounded-xl border border-slate-100">
        <table className="w-full min-w-[700px] text-left">
          <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-500">
            <tr>
              <th className="px-3 py-2.5 w-8">#</th>
              <th className="px-3 py-2.5">Item (from PDF)</th>
              <th className="px-3 py-2.5 w-28">KSBCL Code</th>
              <th className="px-3 py-2.5 w-20 text-right">Rate/cs</th>
              <th className="px-3 py-2.5 w-20 text-right">Indent</th>
              <th className="px-3 py-2.5 w-20 text-right">CNF</th>
              <th className="px-3 py-2.5 w-24">Status</th>
              <th className="px-3 py-2.5">Matched Product</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {matches.map((m) => {
              const item = m.parsedItem
              const rowBg = item.isNotAllocated
                ? "bg-slate-50/60 opacity-60"
                : item.isRationed
                ? "bg-amber-50/40"
                : m.isNewItem
                ? "bg-rose-50/40"
                : ""

              return (
                <tr key={item.srNo} className={`${rowBg} hover:bg-slate-50/70 transition-colors`}>
                  <td className="px-3 py-2.5 text-[10px] font-black text-slate-400">{item.srNo}</td>
                  <td className="px-3 py-2.5">
                    <p className="text-xs font-bold text-slate-900 leading-snug">{item.itemName || item.rawItemName}</p>
                    <p className="text-[9px] text-slate-400 mt-0.5">{item.sizeMl > 0 ? `${item.sizeMl}ml × ${item.bottlesPerCase}/cs` : ""}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-mono text-[10px] font-bold text-slate-700">{item.ksbclBaseCode}</p>
                    {item.ksbclSubCode && (
                      <p className="font-mono text-[9px] text-slate-400">{item.ksbclSubCode}</p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[10px] font-bold text-slate-600 tabular-nums">
                    ₹{item.ratePerCase.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[10px] font-bold text-slate-500 tabular-nums">
                    {qtyLabel(item.indentCases, item.indentBottles)}
                  </td>
                  <td className={`px-3 py-2.5 text-right text-[10px] font-black tabular-nums ${
                    item.isNotAllocated ? "text-slate-400" : item.isRationed ? "text-amber-700" : "text-slate-800"
                  }`}>
                    {item.isNotAllocated ? "—" : qtyLabel(item.cnfCases, item.cnfBottles)}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-0.5">
                      <MatchBadge match={m} />
                      <MapBadge match={m} />
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {item.isNotAllocated ? (
                      <span className="text-[9px] italic text-slate-400">Not allocated by KSBCL</span>
                    ) : m.isNewItem ? (
                      <span className="text-[9px] italic text-slate-400">Map in Review →</span>
                    ) : (
                      <div>
                        <p className="text-xs font-bold text-slate-800">
                          {m.productSizeId
                            ? products.find((p) => p.id === m.productSizeId)
                              ? `${products.find((p) => p.id === m.productSizeId)!.product.name} ${products.find((p) => p.id === m.productSizeId)!.sizeMl}ml`
                              : `Size #${m.productSizeId}`
                            : "—"}
                        </p>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={() => { setResult(null); setMappings({}) }}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors"
        >
          <RotateCcw size={13} /> Upload different PDF
        </button>
        <div className="flex gap-3">
          <Button
            variant="primary"
            onClick={() => router.push(`/indents/${indentId}`)}
            className="flex items-center gap-2"
          >
            Open Indent to Map &amp; Review
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>
    </PageShell>
  )
}
