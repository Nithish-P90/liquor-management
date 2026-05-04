"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import { Search, Plus, Pencil, RefreshCw, Package, ChevronDown, X, Check, AlertTriangle } from "lucide-react"

// ─── Types ──────────────────────────────────────────────────────────────────

type StockRow = {
  productSizeId: number
  productId: number
  name: string
  category: string
  itemCode: string
  ksbclItemCode: string | null
  barcode: string | null
  sizeMl: number
  bottlesPerCase: number
  mrp: string
  sellingPrice: string
  openingBottles: number
  receiptBottles: number
  soldBottles: number
  totalBottles: number
  cases: number
  bottles: number
}

type ProductSize = {
  id?: number
  sizeMl: number
  bottlesPerCase: number
  mrp: number
  sellingPrice: number
  barcode: string
  ksbclItemCode: string
}

type Product = {
  id: number
  itemCode: string
  name: string
  category: string
  sizes: Array<{
    id: number
    sizeMl: number
    bottlesPerCase: number
    mrp: string
    sellingPrice: string
    barcode: string | null
    ksbclItemCode: string | null
  }>
}

const CATEGORIES = ["BRANDY","WHISKY","RUM","VODKA","GIN","WINE","PREMIX","BEER","BEVERAGE","MISCELLANEOUS"]

function fmt(v: string | number): string {
  return "₹" + Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function InventoryPage(): JSX.Element {
  const [tab, setTab] = useState<"stock" | "products">("stock")
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s: { user?: { role?: string } } | { role?: string } | null) => {
        if (!s) return
        const role = "user" in (s as object) ? (s as { user?: { role?: string } }).user?.role : (s as { role?: string }).role
        setIsAdmin(role === "ADMIN")
      })
      .catch(() => {})
  }, [])

  return (
    <main className="min-h-screen bg-[#f8fafc] p-8 lg:p-12">
      <header className="mb-12 flex items-center justify-between border-b-2 border-slate-100 pb-10">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-slate-900">Inventory Management</h1>
          <p className="mt-2 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
            Real-time Stock Control & Article Catalog
          </p>
        </div>
        <div className="flex items-center gap-4">
          <a href="/inventory/opening" className="rounded-2xl border-2 border-slate-100 bg-white px-6 py-3.5 text-[11px] font-black uppercase tracking-widest text-slate-600 hover:border-indigo-200 hover:text-indigo-600 transition-all shadow-sm">
            Opening Registry
          </a>
          <a href="/inventory/closing" className="rounded-2xl border-2 border-slate-100 bg-white px-6 py-3.5 text-[11px] font-black uppercase tracking-widest text-slate-600 hover:border-indigo-200 hover:text-indigo-600 transition-all shadow-sm">
            Closing Registry
          </a>
        </div>
      </header>

      {/* Tabs */}
      <div className="mb-10 flex gap-4">
        {(["stock", "products"] as const).filter(t => t === "stock" || isAdmin).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-2xl px-10 py-4 text-[11px] font-black uppercase tracking-[0.2em] transition-all shadow-lg active:scale-95 ${
              tab === t ? "bg-slate-900 text-white shadow-slate-900/20" : "bg-white text-slate-500 border-2 border-slate-100 hover:border-indigo-300 hover:text-indigo-600"
            }`}
          >
            {t === "stock" ? "Live Inventory" : "Article Catalog"}
          </button>
        ))}
      </div>

      {tab === "stock" ? <StockView isAdmin={isAdmin} /> : <ProductsView />}
    </main>
  )
}

// ─── Live Stock View ─────────────────────────────────────────────────────────

function StockView({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const [rows, setRows] = useState<StockRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("")
  const [editRow, setEditRow] = useState<StockRow | null>(null)
  const [editCases, setEditCases] = useState("")
  const [editBottles, setEditBottles] = useState("")
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string, ok: boolean): void {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async (q: string, cat: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "500" })
      if (q) params.set("search", q)
      if (cat) params.set("category", cat)
      const res = await fetch(`/api/inventory/stock?${params}`, { cache: "no-store" })
      const data = await res.json() as { items?: StockRow[] }
      setRows(data.items ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { void load(search, category) }, 200)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [search, category, load])

  // Auto-refresh every 30 s
  useEffect(() => {
    const id = setInterval(() => { void load(search, category) }, 30000)
    return () => clearInterval(id)
  }, [search, category, load])

  function startEdit(row: StockRow): void {
    setEditRow(row)
    setEditCases(String(row.cases))
    setEditBottles(String(row.bottles))
  }

  async function saveEdit(): Promise<void> {
    if (!editRow) return
    setSaving(true)
    try {
      const res = await fetch(`/api/inventory/stock/${editRow.productSizeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cases: parseInt(editCases || "0"), bottles: parseInt(editBottles || "0") }),
      })
      if (res.ok) {
        showToast("Opening stock updated", true)
        setEditRow(null)
        void load(search, category)
      } else {
        const err = await res.json() as { error?: string }
        showToast(err.error ?? "Save failed", false)
      }
    } finally {
      setSaving(false)
    }
  }

  const totalSkus = rows.length
  const lowStock = rows.filter(r => r.totalBottles < r.bottlesPerCase).length

  return (
    <div>
      {toast && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm font-semibold ${toast.ok ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "bg-red-50 border border-red-200 text-red-800"}`}>
          {toast.msg}
        </div>
      )}

      {/* Summary pills */}
      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
        <MetricCard label="Total Article SKUs" value={String(totalSkus)} color="indigo" icon={Package} />
        <MetricCard 
          label="Low Stock Exposure" 
          value={String(lowStock)} 
          color={lowStock > 0 ? "rose" : "emerald"} 
          icon={AlertTriangle} 
          subValue={lowStock > 0 ? "Replenishment Recommended" : "Optimal Stock Levels"}
        />
        <div className="flex flex-col justify-center">
          <button onClick={() => void load(search, category)} className="w-full flex items-center justify-center gap-3 rounded-2xl bg-white border-2 border-slate-100 px-6 py-6 text-[11px] font-black uppercase tracking-widest text-slate-500 hover:border-indigo-300 hover:text-indigo-600 transition-all shadow-sm active:scale-95">
            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
            Sync Real-time Data
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-8 flex flex-wrap gap-4 items-center border-b-2 border-slate-50 pb-8">
        <div className="flex-1 min-w-[300px] relative group">
          <Search size={18} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search article identity, code or barcode…"
            className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 py-4 pl-14 pr-6 text-base font-black text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all"
          />
        </div>
        <div className="relative min-w-[200px]">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full appearance-none rounded-2xl border-2 border-slate-100 bg-white py-4 pl-6 pr-12 text-[11px] font-black uppercase tracking-widest text-slate-600 focus:border-indigo-400 focus:outline-none transition-all cursor-pointer"
          >
            <option value="">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <ChevronDown size={16} className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-3xl border-2 border-slate-50 bg-white shadow-sm">
        {loading && rows.length === 0 ? (
          <div className="py-20 text-center text-slate-400 font-black uppercase tracking-[0.2em] text-[11px]">Syncing Live Stock Registry…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-slate-100 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 border-b-2 border-slate-50">
                <tr>
                  <th className="px-6 py-5 text-left">Article Profile</th>
                  <th className="px-6 py-5 text-left">Identity Codes</th>
                  <th className="px-6 py-5 text-right">MAGNITUDE</th>
                  <th className="px-6 py-5 text-right">Audit Metrics</th>
                  <th className="px-6 py-5 text-right">Live Inventory</th>
                  {isAdmin && <th className="px-6 py-5 text-center">Manage</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const isEditing = editRow?.productSizeId === row.productSizeId
                  const isLow = row.totalBottles < row.bottlesPerCase && row.totalBottles >= 0
                  const isOut = row.totalBottles <= 0

                  return (
                    <tr key={row.productSizeId} className={`group transition-colors border-b-2 border-slate-50 ${isOut ? "bg-rose-50/30" : isLow ? "bg-amber-50/30" : "hover:bg-slate-50"}`}>
                      <td className="px-6 py-5">
                        <p className="font-black text-slate-900 text-base tracking-tight">{row.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[9px] font-black text-slate-500 uppercase">{row.category}</span>
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{row.sizeMl}ML</span>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">KSBCL / UPC</p>
                        <div className="flex flex-col gap-1">
                          <code className="text-xs font-black text-slate-700">{row.ksbclItemCode ?? row.itemCode ?? "—"}</code>
                          <code className="text-[10px] font-bold text-slate-400">{row.barcode ?? "—"}</code>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">MRP / PRICE</p>
                        <p className="text-xs text-slate-400 line-through font-bold">{fmt(row.mrp)}</p>
                        <p className="text-base font-black text-slate-900">{fmt(row.sellingPrice)}</p>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">OPEN / SOLD</p>
                        <p className="text-sm font-black text-slate-700 tabular-nums">{row.openingBottles} <span className="text-slate-300 mx-1">/</span> <span className="text-rose-500">{row.soldBottles}</span></p>
                      </td>

                      {isEditing ? (
                        <>
                          <td className="px-6 py-5">
                            <div className="flex items-center justify-end gap-2">
                              <div className="flex flex-col gap-1">
                                <label className="text-[8px] font-black text-slate-400 uppercase">Cases</label>
                                <input
                                  type="number" min="0" value={editCases}
                                  onChange={(e) => setEditCases(e.target.value)}
                                  className="w-20 rounded-xl border-2 border-emerald-400 bg-white px-3 py-2 text-right text-sm font-black focus:outline-none shadow-sm"
                                  autoFocus
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-[8px] font-black text-slate-400 uppercase">Btls</label>
                                <input
                                  type="number" min="0" value={editBottles}
                                  onChange={(e) => setEditBottles(e.target.value)}
                                  className="w-20 rounded-xl border-2 border-emerald-400 bg-white px-3 py-2 text-right text-sm font-black focus:outline-none shadow-sm"
                                />
                              </div>
                              <div className="flex gap-1 ml-2">
                                <button onClick={saveEdit} disabled={saving} className="rounded-xl bg-emerald-600 p-3 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 active:scale-90 transition-all">
                                  <Check size={18} />
                                </button>
                                <button onClick={() => setEditRow(null)} className="rounded-xl bg-slate-100 p-3 text-slate-500 hover:bg-slate-200 active:scale-90 transition-all">
                                  <X size={18} />
                                </button>
                              </div>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-6 py-5 text-right">
                            <div className="flex items-center justify-end gap-4">
                              <div className="text-right">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">CASES / EXTRA</p>
                                <p className="text-sm font-black text-slate-700 tabular-nums">{row.cases}c <span className="text-slate-300">+</span> {row.bottles}b</p>
                              </div>
                              <div className="bg-slate-50 rounded-2xl px-6 py-4 border-2 border-slate-100 min-w-[120px]">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 text-center">TOTAL VOLUME</p>
                                <p className={`text-2xl font-black text-center tabular-nums ${isOut ? "text-rose-600" : isLow ? "text-amber-600" : "text-slate-900"}`}>
                                  {row.totalBottles}
                                </p>
                              </div>
                            </div>
                          </td>
                          {isAdmin && (
                            <td className="px-6 py-5 text-center">
                              <button onClick={() => startEdit(row)} className="rounded-2xl border-2 border-slate-100 p-3.5 text-slate-400 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all shadow-sm active:scale-95">
                                <Pencil size={18} />
                              </button>
                            </td>
                          )}
                        </>
                      )}
                    </tr>
                  )
                })}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={isAdmin ? 11 : 10} className="px-5 py-12 text-center text-sm text-slate-400">
                      No products found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Products Management View (admin) ────────────────────────────────────────

type ProductModalState =
  | { mode: "closed" }
  | { mode: "add" }
  | { mode: "edit"; product: Product }

const BLANK_SIZE: ProductSize = { sizeMl: 0, bottlesPerCase: 12, mrp: 0, sellingPrice: 0, barcode: "", ksbclItemCode: "" }

function ProductsView(): JSX.Element {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [modal, setModal] = useState<ProductModalState>({ mode: "closed" })
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok: boolean): void {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async (q: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "500" })
      if (q) params.set("search", q)
      const res = await fetch(`/api/products?${params}`)
      const data = await res.json() as Product[] | { error?: string }
      setProducts(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [])

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => void load(search), 300)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [search, load])

  async function deleteProduct(id: number, name: string): Promise<void> {
    if (!confirm(`Delete "${name}" and all its sizes? This cannot be undone.`)) return
    const res = await fetch(`/api/products/${id}`, { method: "DELETE" })
    if (res.ok) { showToast("Product deleted", true); void load(search) }
    else { const e = await res.json() as { error?: string }; showToast(e.error ?? "Delete failed", false) }
  }

  return (
    <div>
      {toast && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm font-semibold ${toast.ok ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "bg-red-50 border border-red-200 text-red-800"}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[250px]">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full rounded-xl border-2 border-slate-200 bg-white py-3 pl-11 pr-4 text-sm font-bold text-slate-900 placeholder:font-medium placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none transition-colors"
          />
        </div>
        <button
          onClick={() => setModal({ mode: "add" })}
          className="flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-3 text-sm font-black uppercase tracking-widest text-white hover:bg-slate-800 transition-all active:scale-95"
        >
          <Plus size={18} />
          Add Product
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-100 text-[11px] font-black uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-6 py-4 text-left">Name</th>
                <th className="px-6 py-4 text-left">KSBCL Code</th>
                <th className="px-6 py-4 text-left">Category</th>
                <th className="px-6 py-4 text-left">Sizes</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 text-sm font-bold text-slate-900">{p.name}</td>
                  <td className="px-6 py-4 font-mono text-xs font-semibold text-slate-500">{p.itemCode}</td>
                  <td className="px-6 py-4">
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-600 shadow-sm">{p.category}</span>
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-slate-500">
                    {p.sizes.map(s => `${s.sizeMl}ml`).join(" · ")}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setModal({ mode: "edit", product: p })}
                        className="rounded-xl border-2 border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 transition-all">
                        Edit
                      </button>
                      <button onClick={() => void deleteProduct(p.id, p.name)}
                        className="rounded-xl border-2 border-red-200 px-4 py-2 text-xs font-bold text-red-600 hover:border-red-300 hover:bg-red-50 transition-all">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && products.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-400">No products found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal.mode !== "closed" && (
        <ProductModal
          mode={modal.mode}
          product={modal.mode === "edit" ? modal.product : undefined}
          onClose={() => setModal({ mode: "closed" })}
          onSaved={() => { setModal({ mode: "closed" }); void load(search) }}
          showToast={showToast}
        />
      )}
    </div>
  )
}

// ─── Product Add/Edit Modal ───────────────────────────────────────────────────

function ProductModal({
  mode, product, onClose, onSaved, showToast,
}: {
  mode: "add" | "edit"
  product?: Product
  onClose: () => void
  onSaved: () => void
  showToast: (msg: string, ok: boolean) => void
}): JSX.Element {
  const [name, setName] = useState(product?.name ?? "")
  const [itemCode, setItemCode] = useState(product?.itemCode ?? "")
  const [category, setCategory] = useState(product?.category ?? "WHISKY")
  const [sizes, setSizes] = useState<ProductSize[]>(
    product?.sizes.length
      ? product.sizes.map(s => ({
          id: s.id,
          sizeMl: s.sizeMl,
          bottlesPerCase: s.bottlesPerCase,
          mrp: Number(s.mrp),
          sellingPrice: Number(s.sellingPrice),
          barcode: s.barcode ?? "",
          ksbclItemCode: s.ksbclItemCode ?? "",
        }))
      : [{ ...BLANK_SIZE }],
  )
  const [saving, setSaving] = useState(false)

  function addSize(): void {
    setSizes((prev) => [...prev, { ...BLANK_SIZE }])
  }

  function removeSize(i: number): void {
    setSizes((prev) => prev.filter((_, idx) => idx !== i))
  }

  function updateSize(i: number, field: keyof ProductSize, value: string | number): void {
    setSizes((prev) => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }

  async function save(): Promise<void> {
    if (!name.trim() || !itemCode.trim()) { showToast("Name and KSBCL code are required", false); return }
    if (sizes.some(s => s.sizeMl <= 0 || s.mrp <= 0)) { showToast("All sizes need a valid ml and MRP", false); return }

    setSaving(true)
    try {
      let res: Response
      if (mode === "add") {
        res = await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemCode, name, category, sizes }),
        })
      } else {
        res = await fetch(`/api/products/${product!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemCode, name, category, sizes }),
        })
      }

      if (res.ok) {
        showToast(mode === "add" ? "Product created" : "Product updated", true)
        onSaved()
      } else {
        const err = await res.json() as { error?: string }
        showToast(err.error ?? "Save failed", false)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-black text-slate-900">
            {mode === "add" ? "Add Product" : `Edit — ${product?.name}`}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Product fields */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Product Name *">
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Royal Stag"
                className="field-input" />
            </Field>
            <Field label="KSBCL Item Code *">
              <input value={itemCode} onChange={(e) => setItemCode(e.target.value)}
                placeholder="e.g. KSBCL-001"
                className="field-input" />
            </Field>
            <Field label="Category">
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="field-input">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          {/* Sizes */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold text-slate-700">Sizes / SKUs</p>
              <button onClick={addSize} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <Plus size={12} /> Add Size
              </button>
            </div>
            <div className="space-y-3">
              {sizes.map((size, i) => (
                <div key={i} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-500">Size #{i + 1}</p>
                    {sizes.length > 1 && (
                      <button onClick={() => removeSize(i)} className="text-red-400 hover:text-red-600">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Field label="Size (ml)">
                      <input type="number" min="1" value={size.sizeMl || ""} onChange={(e) => updateSize(i, "sizeMl", parseInt(e.target.value) || 0)}
                        placeholder="750" className="field-input" />
                    </Field>
                    <Field label="Btls/Case">
                      <input type="number" min="1" value={size.bottlesPerCase} onChange={(e) => updateSize(i, "bottlesPerCase", parseInt(e.target.value) || 12)}
                        className="field-input" />
                    </Field>
                    <Field label="MRP (₹)">
                      <input type="number" min="0" step="0.01" value={size.mrp || ""} onChange={(e) => updateSize(i, "mrp", parseFloat(e.target.value) || 0)}
                        placeholder="0.00" className="field-input" />
                    </Field>
                    <Field label="Selling Price (₹)">
                      <input type="number" min="0" step="0.01" value={size.sellingPrice || ""} onChange={(e) => updateSize(i, "sellingPrice", parseFloat(e.target.value) || 0)}
                        placeholder="0.00" className="field-input" />
                    </Field>
                    <Field label="Barcode">
                      <input value={size.barcode} onChange={(e) => updateSize(i, "barcode", e.target.value)}
                        placeholder="Optional" className="field-input" />
                    </Field>
                    <Field label="KSBCL Size Code">
                      <input value={size.ksbclItemCode} onChange={(e) => updateSize(i, "ksbclItemCode", e.target.value)}
                        placeholder="Optional" className="field-input" />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
            <Package size={14} />
            {saving ? "Saving…" : mode === "add" ? "Create Product" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value, color, icon: Icon, subValue }: { label: string; value: string; color: "emerald" | "indigo" | "rose" | "slate"; icon: React.ElementType; subValue?: string }): JSX.Element {
  const tones = {
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    indigo: "border-indigo-100 bg-indigo-50 text-indigo-700",
    rose: "border-rose-100 bg-rose-50 text-rose-700",
    slate: "border-slate-100 bg-slate-50 text-slate-600",
  }[color]

  return (
    <div className={`rounded-[2.5rem] border-2 p-10 shadow-sm transition-all hover:shadow-xl hover:-translate-y-1 ${tones}`}>
      <div className="flex justify-between items-start mb-6">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60">{label}</p>
        <div className="rounded-2xl bg-white/50 p-3 shadow-inner">
          <Icon size={24} />
        </div>
      </div>
      <p className="text-5xl font-black tracking-tighter tabular-nums">{value}</p>
      {subValue && <p className="mt-4 text-[10px] font-black uppercase tracking-widest opacity-60">{subValue}</p>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-1">{label}</label>
      {children}
    </div>
  )
}
