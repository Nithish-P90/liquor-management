"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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
    <main className="min-h-screen bg-[#f8fafc] p-6 lg:p-10">
      <header className="mb-8 flex items-center justify-between border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Inventory</h1>
          <p className="mt-1 text-sm font-semibold uppercase tracking-widest text-slate-400">
            Live stock · Product management
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a href="/inventory/opening" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
            Opening Stock
          </a>
          <a href="/inventory/closing" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
            Closing Stock
          </a>
        </div>
      </header>

      {/* Tabs */}
      <div className="mb-6 flex gap-2">
        {(["stock", "products"] as const).filter(t => t === "stock" || isAdmin).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-xl px-5 py-2.5 text-sm font-bold transition ${
              tab === t ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {t === "stock" ? "Live Stock" : "Products"}
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
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-2">
          <span className="text-xs font-bold text-slate-400">SKUs</span>
          <span className="ml-2 text-sm font-black text-slate-900">{totalSkus}</span>
        </div>
        {lowStock > 0 && (
          <div className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2">
            <AlertTriangle size={13} className="text-amber-500" />
            <span className="text-xs font-bold text-amber-700">{lowStock} low stock</span>
          </div>
        )}
        <button onClick={() => void load(search, category)} className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, KSBCL code, barcode…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm text-slate-900 focus:border-emerald-400 focus:outline-none"
          />
        </div>
        <div className="relative">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-4 pr-8 text-sm font-semibold text-slate-700 focus:border-emerald-400 focus:outline-none"
          >
            <option value="">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading && rows.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-5 py-3.5 text-left">Product</th>
                  <th className="px-5 py-3.5 text-left">KSBCL</th>
                  <th className="px-5 py-3.5 text-left">Barcode</th>
                  <th className="px-5 py-3.5 text-right">MRP</th>
                  <th className="px-5 py-3.5 text-right">Price</th>
                  <th className="px-5 py-3.5 text-right">Opening</th>
                  <th className="px-5 py-3.5 text-right">Sold</th>
                  <th className="px-5 py-3.5 text-right">Cases</th>
                  <th className="px-5 py-3.5 text-right">Btls</th>
                  <th className="px-5 py-3.5 text-right">Total</th>
                  {isAdmin && <th className="px-5 py-3.5 text-right">Edit</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const isEditing = editRow?.productSizeId === row.productSizeId
                  const isLow = row.totalBottles < row.bottlesPerCase && row.totalBottles >= 0
                  const isOut = row.totalBottles <= 0

                  return (
                    <tr key={row.productSizeId} className={`transition ${isOut ? "bg-red-50/40" : isLow ? "bg-amber-50/40" : "hover:bg-slate-50/50"}`}>
                      <td className="px-5 py-3">
                        <p className="font-bold text-slate-900">{row.name}</p>
                        <p className="text-xs text-slate-400">{row.sizeMl}ml · {row.category}</p>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-500">{row.ksbclItemCode ?? row.itemCode ?? "—"}</td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-500">{row.barcode ?? "—"}</td>
                      <td className="px-5 py-3 text-right text-sm text-slate-600">{fmt(row.mrp)}</td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-800">{fmt(row.sellingPrice)}</td>
                      <td className="px-5 py-3 text-right text-slate-500">{row.openingBottles}</td>
                      <td className="px-5 py-3 text-right text-slate-500">{row.soldBottles}</td>

                      {isEditing ? (
                        <>
                          <td className="px-3 py-2">
                            <input
                              type="number" min="0" value={editCases}
                              onChange={(e) => setEditCases(e.target.value)}
                              className="w-16 rounded border border-emerald-400 px-2 py-1 text-right text-sm"
                              autoFocus
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min="0" value={editBottles}
                              onChange={(e) => setEditBottles(e.target.value)}
                              className="w-16 rounded border border-emerald-400 px-2 py-1 text-right text-sm"
                            />
                          </td>
                          <td className="px-3 py-2 text-right text-sm text-slate-400">—</td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={saveEdit} disabled={saving} className="rounded-lg bg-emerald-600 px-2 py-1 text-white hover:bg-emerald-700 disabled:opacity-50">
                                <Check size={13} />
                              </button>
                              <button onClick={() => setEditRow(null)} className="rounded-lg border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-100">
                                <X size={13} />
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-5 py-3 text-right font-semibold text-slate-700">{row.cases}</td>
                          <td className="px-5 py-3 text-right font-semibold text-slate-700">{row.bottles}</td>
                          <td className={`px-5 py-3 text-right font-black ${isOut ? "text-red-600" : isLow ? "text-amber-600" : "text-slate-900"}`}>
                            {row.totalBottles}
                          </td>
                          {isAdmin && (
                            <td className="px-5 py-3 text-right">
                              <button onClick={() => startEdit(row)} className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:border-slate-400 hover:text-slate-700">
                                <Pencil size={13} />
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

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm text-slate-900 focus:border-emerald-400 focus:outline-none"
          />
        </div>
        <button
          onClick={() => setModal({ mode: "add" })}
          className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
        >
          <Plus size={15} />
          Add Product
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-5 py-3.5 text-left">Name</th>
                <th className="px-5 py-3.5 text-left">KSBCL Code</th>
                <th className="px-5 py-3.5 text-left">Category</th>
                <th className="px-5 py-3.5 text-left">Sizes</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/50">
                  <td className="px-5 py-3 font-bold text-slate-900">{p.name}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{p.itemCode}</td>
                  <td className="px-5 py-3">
                    <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">{p.category}</span>
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {p.sizes.map(s => `${s.sizeMl}ml`).join(" · ")}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setModal({ mode: "edit", product: p })}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                        Edit
                      </button>
                      <button onClick={() => void deleteProduct(p.id, p.name)}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50">
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

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold text-slate-500">{label}</label>
      {children}
    </div>
  )
}
