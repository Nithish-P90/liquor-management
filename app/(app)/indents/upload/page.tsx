"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/Button"
import { PageShell } from "@/components/PageShell"

type ParseResult = {
  indentId: number
  warnings: string[]
  matches: Array<{
    parsedItem: { ksbclItemCode: string; itemName: string; sizeMl: number; cnfCases: number; cnfBottles: number; cnfAmount: number }
    productSizeId: number | null
    confidence: number
    isNewItem: boolean
    matchReason: string
  }>
}

export default function UploadPage(): JSX.Element {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [result, setResult] = useState<ParseResult | null>(null)
  const [error, setError] = useState("")

  async function handleFile(file: File): Promise<void> {
    if (!file.name.endsWith(".pdf")) { setError("Please select a PDF file"); return }
    setError("")
    setParsing(true)
    setResult(null)

    const formData = new FormData()
    formData.append("pdf", file)

    const res = await fetch("/api/indents/parse", { method: "POST", body: formData })
    setParsing(false)

    if (res.ok) {
      const data: ParseResult = await res.json()
      setResult(data)
    } else {
      const err = await res.json()
      setError(err.error ?? "Parse failed")
    }
  }

  function handleDrop(e: React.DragEvent): void {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <PageShell title="Upload KSBCL PDF" subtitle="Parse and review indent before confirming stock arrival.">
      {!result ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`flex h-48 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition ${dragging ? "border-emerald-500 bg-emerald-500/10" : "border-slate-700 hover:border-slate-600"}`}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          {parsing ? (
            <p className="text-sm text-slate-400">Parsing PDF…</p>
          ) : (
            <>
              <p className="text-lg text-slate-300">Drop PDF here or click to browse</p>
              <p className="mt-1 text-xs text-slate-500">KSBCL indent PDF only</p>
            </>
          )}
        </div>
      ) : (
        <div>
          {result.warnings.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-800 bg-amber-900/20 p-4">
              <p className="mb-2 text-sm font-medium text-amber-300">Warnings</p>
              <ul className="list-disc pl-5 text-xs text-amber-400">
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          <div className="mb-4 overflow-hidden rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/60">
                <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                  <th className="px-3 py-2">KSBCL Code</th>
                  <th className="px-3 py-2">Item Name</th>
                  <th className="px-3 py-2">Size</th>
                  <th className="px-3 py-2">Cnf Qty</th>
                  <th className="px-3 py-2">Match</th>
                  <th className="px-3 py-2">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {result.matches.map((m, i) => (
                  <tr key={i} className={`border-t border-slate-800 ${m.isNewItem ? "bg-red-900/10" : ""}`}>
                    <td className="px-3 py-2 font-mono text-xs text-slate-300">{m.parsedItem.ksbclItemCode}</td>
                    <td className="px-3 py-2 text-slate-200">{m.parsedItem.itemName}</td>
                    <td className="px-3 py-2 text-slate-400">{m.parsedItem.sizeMl}ml</td>
                    <td className="px-3 py-2 text-slate-300">{m.parsedItem.cnfCases}cs {m.parsedItem.cnfBottles}bt</td>
                    <td className="px-3 py-2">
                      {m.isNewItem ? (
                        <span className="rounded-full bg-red-900/50 px-2 py-0.5 text-xs text-red-300">NEW — unmapped</span>
                      ) : (
                        <span className="rounded-full bg-emerald-900/50 px-2 py-0.5 text-xs text-emerald-300">
                          {m.matchReason === "exact_ksbcl_code" ? "Exact" : "Fuzzy"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-400">{(m.confidence * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <Button variant="primary" onClick={() => router.push(`/indents/${result.indentId}`)}>
              Review & Map
            </Button>
            <Button variant="secondary" onClick={() => setResult(null)}>
              Upload Another
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </PageShell>
  )
}
