"use client"

import { useEffect, useState } from "react"
import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"
import { useParams } from "next/navigation"

type ProductSize = { id: number; sizeMl: number; product: { name: string } }

type IndentItem = {
  id: number
  itemCode: string
  itemName: string
  size: string
  quantity: number
  mrp: string
  productSizeId: number | null
  productSize?: ProductSize
}

type Indent = {
  id: number
  documentNumber: string
  status: string
  totalBoxes: number
  totalAmount: string
  items: IndentItem[]
}

export default function IndentDetailPage(): JSX.Element {
  const { id } = useParams() as { id: string }
  const [indent, setIndent] = useState<Indent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [posItems, setPosItems] = useState<{kind: string; item: any}[]>([])

  useEffect(() => {
    fetchIndent()
    fetchPosItems()
  }, [id])

  async function fetchPosItems() {
    try {
      const res = await fetch("/api/pos/items")
      if (res.ok) setPosItems(await res.json())
    } catch {}
  }

  async function fetchIndent() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/indents/${id}`)
      if (!res.ok) throw new Error("Failed to load indent")
      setIndent(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error loading indent")
    } finally {
      setLoading(false)
    }
  }

  async function handleMapItem(itemId: number, sizeId: number) {
    try {
      const res = await fetch(`/api/indents/${id}/map-item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indentItemId: itemId, productSizeId: sizeId }),
      })
      if (!res.ok) throw new Error("Mapping failed")
      fetchIndent()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Mapping failed")
    }
  }

  async function handleConfirm() {
    if (!confirm("Are you sure you want to confirm arrival? This will update stock.")) return
    setConfirming(true)
    try {
      const res = await fetch(`/api/indents/${id}/confirm`, { method: "POST" })
      if (!res.ok) throw new Error("Confirm failed")
      alert("Indent confirmed successfully!")
      fetchIndent()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Confirm failed")
    } finally {
      setConfirming(false)
    }
  }

  if (loading) return <PageShell title="Indent Detail" subtitle=""><p>Loading...</p></PageShell>
  if (error || !indent) return <PageShell title="Indent Detail" subtitle=""><p className="text-red-500">{error}</p></PageShell>

  const isMapped = indent.items.every(i => i.productSizeId !== null)
  const canConfirm = indent.status !== "CONFIRMED" && isMapped

  return (
    <PageShell title={`Indent: ${indent.documentNumber}`} subtitle="Review items, map to products, and confirm stock arrival.">
      <div className="mb-6 flex justify-between items-center rounded-xl bg-white p-6 shadow-sm border border-slate-200">
        <div>
          <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">Status</p>
          <span className={`inline-flex rounded-full px-3 py-1 text-sm font-black ${
            indent.status === "CONFIRMED" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
          }`}>
            {indent.status}
          </span>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">Total Amount</p>
          <p className="text-2xl font-black text-slate-900">₹{Number(indent.totalAmount).toFixed(2)}</p>
        </div>
        <Button onClick={handleConfirm} disabled={!canConfirm || confirming} variant={canConfirm ? "primary" : "secondary"}>
          {confirming ? "Confirming..." : "Confirm Arrival"}
        </Button>
      </div>

      {!isMapped && indent.status !== "CONFIRMED" && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm font-bold">
          Some items are not mapped to products. Please map all items before confirming.
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-6 py-4 font-semibold">KSBCL Item</th>
              <th className="px-6 py-4 font-semibold">Quantity</th>
              <th className="px-6 py-4 font-semibold">MRP</th>
              <th className="px-6 py-4 font-semibold">Mapped Product</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {indent.items.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50/50">
                <td className="px-6 py-4">
                  <p className="font-bold text-slate-900">{item.itemName}</p>
                  <p className="text-xs text-slate-500">Code: {item.itemCode} • Size: {item.size}</p>
                </td>
                <td className="px-6 py-4 font-bold text-slate-900">{item.quantity} box</td>
                <td className="px-6 py-4 font-bold text-slate-900">₹{item.mrp}</td>
                <td className="px-6 py-4">
                  {item.productSizeId && item.productSize ? (
                    <span className="inline-flex rounded-md bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
                      {item.productSize.product.name} ({item.productSize.sizeMl}ml)
                    </span>
                  ) : indent.status !== "CONFIRMED" ? (
                    <select
                      className="text-sm border border-slate-300 rounded p-1 max-w-[200px]"
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10)
                        if (val) handleMapItem(item.id, val)
                      }}
                      defaultValue=""
                    >
                      <option value="" disabled>Select Product...</option>
                      {posItems.filter(p => p.kind === "LIQUOR").map(p => (
                        <option key={p.item.id} value={p.item.id}>
                          {p.item.product.name} ({p.item.sizeMl}ml)
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-slate-400 italic text-xs">Unmapped</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  )
}
