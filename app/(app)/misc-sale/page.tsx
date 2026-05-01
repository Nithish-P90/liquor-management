"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"

type MiscItemResult = {
  id: number
  name: string
  unit: string
  price: string
  category: string
  barcode: string | null
}

type SearchResult =
  | { kind: "LIQUOR"; item: unknown }
  | { kind: "MISC"; item: MiscItemResult }

function fmt(v: string | number): string {
  return "₹" + Number(v).toFixed(2)
}

export default function Page(): JSX.Element {
  const [items, setItems] = useState<MiscItemResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [category, setCategory] = useState("ALL")

  const fetchItems = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/pos/items", { cache: "no-store" })
      if (!res.ok) throw new Error("Failed to load POS items")
      const data = (await res.json()) as SearchResult[]
      const misc = (Array.isArray(data) ? data : [])
        .filter((r) => r && typeof r === "object" && (r as SearchResult).kind === "MISC")
        .map((r) => (r as { kind: "MISC"; item: MiscItemResult }).item)
      setItems(misc)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchItems()
  }, [fetchItems])

  const categories = useMemo(() => {
    const s = new Set(items.map((i) => i.category).filter(Boolean))
    return ["ALL", ...Array.from(s).sort()]
  }, [items])

  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase()
    return items.filter((i) => {
      if (category !== "ALL" && i.category !== category) return false
      if (!text) return true
      return (
        i.name.toLowerCase().includes(text) ||
        (i.barcode ?? "").toLowerCase().includes(text) ||
        i.category.toLowerCase().includes(text)
      )
    })
  }, [items, q, category])

  return (
    <PageShell title="Misc Sales" subtitle="Browse cashier-owned items used by POS (read-only).">
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        This page currently reads misc items from <code className="font-mono">/api/pos/items</code>. Create/update flows
        for misc items are not implemented yet (no dedicated API routes exist in this repo).
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name / barcode / category..."
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Button onClick={fetchItems} disabled={loading} variant="secondary">
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
        <a
          href="/pos"
          className="ml-auto rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Open POS
        </a>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && filtered.length === 0 ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-500">No misc items.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Barcode</th>
                <th className="px-4 py-3">Unit</th>
                <th className="px-4 py-3 text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id} className="border-t border-slate-200">
                  <td className="px-4 py-3 font-semibold text-slate-900">{i.name}</td>
                  <td className="px-4 py-3 text-slate-700">{i.category}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{i.barcode ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-700">{i.unit}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(i.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  )
}
