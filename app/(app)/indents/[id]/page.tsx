"use client"

import React, { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { CheckCircle2, AlertTriangle, XCircle, AlertCircle, Package } from "lucide-react"
import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"

// ── Types (mirrors what /api/indents/[id] returns) ──────────────────────────

type ProductSize = {
  id: number
  sizeMl: number
  ksbclItemCode: string | null
  product: { name: string; category: string }
}

type IndentItemRow = {
  id: number
  ksbclItemCode: string | null
  rawItemName: string | null
  isRationed: boolean
  isNewItem: boolean
  mappingConfidence: number | null
  ratePerCase: string
  indentCases: number
  indentBottles: number
  indentAmount: string
  cnfCases: number
  cnfBottles: number
  cnfAmount: string
  receivedCases: number
  receivedBottles: number
  productSize: ProductSize | null
}

type Indent = {
  id: number
  indentNumber: string
  invoiceNumber: string
  retailerName: string
  retailerId: string
  indentDate: string
  status: string
  totalIndentValue: string | null
  totalConfirmedValue: string | null
  parseWarnings: string[] | null
  items: IndentItemRow[]
}

type ProductOption = {
  id: number
  sizeMl: number
  product: { name: string; category: string }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function qtyLabel(cases: number, bottles: number): string {
  if (cases === 0 && bottles === 0) return "—"
  const parts: string[] = []
  if (cases > 0) parts.push(`${cases} cs`)
  if (bottles > 0) parts.push(`${bottles} bt`)
  return parts.join(" + ")
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700 border-amber-200",
  PARTIAL: "bg-blue-100 text-blue-700 border-blue-200",
  FULLY_RECEIVED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  STOCK_ADDED: "bg-slate-900 text-white border-slate-900",
}

// ── Main component ────────────────────────────────────────────────────────────

export default function IndentDetailPage(): JSX.Element {
  const { id } = useParams() as { id: string }
  const [indent, setIndent] = useState<Indent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [products, setProducts] = useState<ProductOption[]>([])
  const [remapping, setRemapping] = useState<number | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok: boolean): void {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchIndent = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/indents/${id}`)
      if (!res.ok) throw new Error("Failed to load indent")
      setIndent(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error loading indent")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchIndent()
    fetch("/api/pos/items")
      .then((r) => r.json())
      .then((data: Array<{ kind: string; item: ProductOption }>) =>
        setProducts(data.filter((d) => d.kind === "LIQUOR").map((d) => d.item))
      )
      .catch(() => {})
  }, [fetchIndent])

  async function handleRemap(itemId: number, productSizeId: number): Promise<void> {
    setRemapping(itemId)
    try {
      const res = await fetch(`/api/indents/${id}/map-item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indentItemId: itemId, productSizeId }),
      })
      if (!res.ok) throw new Error("Mapping failed")
      showToast("Item mapped — KSBCL code saved for future imports", true)
      await fetchIndent()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Mapping failed", false)
    } finally {
      setRemapping(null)
    }
  }

  async function handleConfirm(): Promise<void> {
    if (!confirm("Confirm receipt? This will add stock to inventory.")) return
    setConfirming(true)
    try {
      const res = await fetch(`/api/indents/${id}/confirm`, { method: "POST" })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? "Confirm failed")
      }
      showToast("Stock added to inventory", true)
      await fetchIndent()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Confirm failed", false)
    } finally {
      setConfirming(false)
    }
  }

  if (loading) {
    return (
      <PageShell title="Indent" subtitle="">
        <div className="py-12 text-center text-xs font-black uppercase tracking-widest text-slate-400 animate-pulse">
          Loading…
        </div>
      </PageShell>
    )
  }

  if (error || !indent) {
    return (
      <PageShell title="Indent" subtitle="">
        <p className="text-sm text-rose-600 font-bold">{error || "Not found"}</p>
      </PageShell>
    )
  }

  const unmapped = indent.items.filter((i) => i.isNewItem || !i.productSize)
  const rationed = indent.items.filter((i) => i.isRationed)
  const notAllocated = indent.items.filter((i) => i.cnfCases === 0 && i.cnfBottles === 0)
  const canConfirm = indent.status !== "STOCK_ADDED" && unmapped.length === 0
  const warnings = (indent.parseWarnings as string[] | null) ?? []

  return (
    <PageShell
      title={indent.indentNumber}
      subtitle={`${indent.retailerName} • ${indent.indentDate?.slice(0, 10)}`}
    >
      {toast && (
        <div className={`mb-4 rounded-lg border px-4 py-3 text-xs font-bold animate-in slide-in-from-top-2 ${
          toast.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Status bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-lg border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${STATUS_STYLE[indent.status] ?? "bg-slate-100 text-slate-500 border-slate-200"}`}>
            {indent.status.replace(/_/g, " ")}
          </span>
          <span className="text-[10px] font-bold text-slate-500">Invoice: {indent.invoiceNumber}</span>
          {indent.totalConfirmedValue && (
            <span className="text-[10px] font-black text-slate-700">
              CNF ₹{Number(indent.totalConfirmedValue).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </span>
          )}
          {rationed.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-black text-amber-600">
              <AlertTriangle size={11} /> {rationed.length} rationed
            </span>
          )}
          {notAllocated.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-black text-slate-400">
              <XCircle size={11} /> {notAllocated.length} not allocated
            </span>
          )}
          {unmapped.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-black text-rose-600">
              <AlertCircle size={11} /> {unmapped.length} unmapped
            </span>
          )}
        </div>
        {indent.status !== "STOCK_ADDED" && (
          <Button
            variant={canConfirm ? "primary" : "secondary"}
            onClick={handleConfirm}
            disabled={!canConfirm || confirming}
            className="flex items-center gap-2 text-[10px]"
          >
            <Package size={13} />
            {confirming ? "Adding Stock…" : "Confirm Receipt & Add Stock"}
          </Button>
        )}
        {indent.status === "STOCK_ADDED" && (
          <span className="flex items-center gap-1.5 text-[10px] font-black text-emerald-700">
            <CheckCircle2 size={13} /> Stock added to inventory
          </span>
        )}
      </div>

      {!canConfirm && unmapped.length > 0 && indent.status !== "STOCK_ADDED" && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">
          Map all {unmapped.length} unmapped item{unmapped.length !== 1 ? "s" : ""} to your product catalogue before confirming receipt.
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-amber-700">Parse Warnings</p>
          {warnings.map((w, i) => <p key={i} className="text-xs text-amber-700">• {w}</p>)}
        </div>
      )}

      {/* Items table */}
      <div className="overflow-x-auto rounded-xl border border-slate-100">
        <table className="w-full min-w-[720px] text-left">
          <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-500">
            <tr>
              <th className="px-3 py-2.5 w-8">#</th>
              <th className="px-3 py-2.5">Item</th>
              <th className="px-3 py-2.5 w-28">KSBCL Code</th>
              <th className="px-3 py-2.5 w-20 text-right">Rate/cs</th>
              <th className="px-3 py-2.5 w-22 text-right">Indent</th>
              <th className="px-3 py-2.5 w-22 text-right">CNF</th>
              <th className="px-3 py-2.5 w-20 text-right">CNF ₹</th>
              <th className="px-3 py-2.5">Mapped Product</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {indent.items.map((item) => {
              const isNotAlloc = item.cnfCases === 0 && item.cnfBottles === 0
              const rowBg = isNotAlloc
                ? "opacity-50"
                : item.isRationed
                ? "bg-amber-50/50"
                : (item.isNewItem || !item.productSize)
                ? "bg-rose-50/40"
                : ""

              return (
                <tr key={item.id} className={`${rowBg} hover:bg-slate-50 transition-colors`}>
                  <td className="px-3 py-2.5 text-[10px] font-black text-slate-400">
                    {indent.items.indexOf(item) + 1}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-0.5">
                      <p className="text-xs font-bold text-slate-900 leading-snug">
                        {item.productSize
                          ? `${item.productSize.product.name} ${item.productSize.sizeMl}ml`
                          : item.rawItemName || "Unknown item"}
                      </p>
                      {item.rawItemName && item.productSize && (
                        <p className="text-[9px] text-slate-400">{item.rawItemName}</p>
                      )}
                      <div className="flex gap-1 mt-0.5">
                        {isNotAlloc && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[8px] font-black uppercase text-slate-500">
                            <XCircle size={8} /> Not Allocated
                          </span>
                        )}
                        {item.isRationed && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[8px] font-black uppercase text-amber-700">
                            <AlertTriangle size={8} /> Rationed
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-mono text-[10px] font-bold text-slate-600">
                      {item.ksbclItemCode ?? "—"}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-right text-[10px] font-bold text-slate-500 tabular-nums">
                    ₹{Number(item.ratePerCase).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[10px] font-bold text-slate-500 tabular-nums">
                    {qtyLabel(item.indentCases, item.indentBottles)}
                  </td>
                  <td className={`px-3 py-2.5 text-right text-[10px] font-black tabular-nums ${
                    isNotAlloc ? "text-slate-300" : item.isRationed ? "text-amber-700" : "text-slate-800"
                  }`}>
                    {qtyLabel(item.cnfCases, item.cnfBottles)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[10px] font-bold text-slate-600 tabular-nums">
                    {isNotAlloc ? "—" : `₹${Number(item.cnfAmount).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
                  </td>
                  <td className="px-3 py-2.5">
                    {item.productSize ? (
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />
                        <span className="text-xs font-bold text-slate-800">
                          {item.productSize.product.name} {item.productSize.sizeMl}ml
                        </span>
                        {indent.status !== "STOCK_ADDED" && (
                          <select
                            className="ml-2 rounded border border-slate-200 bg-white px-1 py-0.5 text-[9px] text-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400"
                            defaultValue=""
                            disabled={remapping === item.id}
                            onChange={(e) => { const v = parseInt(e.target.value); if (v) handleRemap(item.id, v) }}
                          >
                            <option value="">Remap…</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.product.name} {p.sizeMl}ml
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    ) : isNotAlloc ? (
                      <span className="text-[9px] italic text-slate-400">Not allocated — skip</span>
                    ) : indent.status !== "STOCK_ADDED" ? (
                      <div className="flex items-center gap-1.5">
                        <AlertCircle size={11} className="text-rose-400 shrink-0" />
                        <select
                          className="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[9px] font-bold text-rose-700 focus:outline-none focus:ring-1 focus:ring-rose-300"
                          defaultValue=""
                          disabled={remapping === item.id}
                          onChange={(e) => { const v = parseInt(e.target.value); if (v) handleRemap(item.id, v) }}
                        >
                          <option value="" disabled>Select product to map…</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.product.name} {p.sizeMl}ml
                            </option>
                          ))}
                        </select>
                        {remapping === item.id && <span className="text-[9px] text-slate-400">Saving…</span>}
                      </div>
                    ) : (
                      <span className="text-[9px] italic text-slate-400 flex items-center gap-1">
                        <XCircle size={10} className="text-rose-400" /> Unmapped
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </PageShell>
  )
}
