'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'

// ── Types ─────────────────────────────────────────────────────────────────────

type MiscCategory = 'CIGARETTES' | 'SNACKS' | 'CUPS'
type MiscUnit = 'pcs' | 'pack' | 'box' | 'strip'

type MiscItem = {
  id: number
  barcode: string | null
  name: string
  category: MiscCategory
  unit: MiscUnit
  price: number
}

type CartItem = { item: MiscItem; quantity: number }

type SaleRecord = {
  id: number
  staffName?: string
  quantity: number
  unitPrice: number
  totalAmount: number
  saleTime: string
  item: { id: number; name: string; category: MiscCategory; unit: MiscUnit; price: number }
}

type CategorySummary = { items: number; amount: number; entries: number }

type MiscSalesSummary = {
  totalAmount: number
  items: number
  entries: number
  categories: Record<MiscCategory, CategorySummary>
}

type RangeSummary = {
  from: string
  to: string
  totalAmount: number
  totalItems: number
  totalEntries: number
  byMode: Array<{ mode: string; amount: number; qty: number }>
  categories: {
    CIGARETTES: { amount: number; items: number; entries: number }
    SNACKS: { amount: number; items: number; entries: number }
    CUPS: { amount: number; items: number; entries: number }
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES: MiscCategory[] = ['CIGARETTES', 'SNACKS', 'CUPS']

const CAT_LABEL: Record<MiscCategory, string> = {
  CIGARETTES: 'Cigarettes',
  SNACKS: 'Snacks',
  CUPS: 'Cups',
}

const CAT_COLORS: Record<MiscCategory, { bg: string; border: string; text: string; badge: string }> = {
  CIGARETTES: { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   badge: 'bg-amber-100 text-amber-700' },
  SNACKS:     { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700' },
  CUPS:       { bg: 'bg-blue-50',    border: 'border-blue-200',    text: 'text-blue-700',    badge: 'bg-blue-100 text-blue-700' },
}

const UNIT_OPTIONS: { value: MiscUnit; label: string }[] = [
  { value: 'pcs',   label: 'Pieces (pcs)' },
  { value: 'pack',  label: 'Pack' },
  { value: 'box',   label: 'Box' },
  { value: 'strip', label: 'Strip' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function rupee(n: number) {
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

function asNumber(v: unknown) {
  const n = Number(v); return Number.isFinite(n) ? n : 0
}

function asCategory(v: unknown): MiscCategory {
  if (v === 'CIGARETTES' || v === 'SNACKS' || v === 'CUPS') return v
  return 'CIGARETTES'
}

function asUnit(v: unknown): MiscUnit {
  if (v === 'pcs' || v === 'pack' || v === 'box' || v === 'strip') return v
  return 'pcs'
}

function emptySummary(): MiscSalesSummary {
  return {
    totalAmount: 0, items: 0, entries: 0,
    categories: {
      CIGARETTES: { items: 0, amount: 0, entries: 0 },
      SNACKS:     { items: 0, amount: 0, entries: 0 },
      CUPS:       { items: 0, amount: 0, entries: 0 },
    },
  }
}

function normalizeSalesRows(value: unknown): SaleRecord[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
    .map(r => {
      const item = (r.item && typeof r.item === 'object') ? r.item as Record<string, unknown> : {}
      return {
        id: asNumber(r.id),
        staffName: typeof r.staffName === 'string' ? r.staffName : undefined,
        quantity: asNumber(r.quantity),
        unitPrice: asNumber(r.unitPrice),
        totalAmount: asNumber(r.totalAmount),
        saleTime: typeof r.saleTime === 'string' ? r.saleTime : '',
        item: {
          id: asNumber(item.id),
          name: typeof item.name === 'string' ? item.name : 'Unknown',
          category: asCategory(item.category),
          unit: asUnit(item.unit),
          price: asNumber(item.price),
        },
      }
    })
    .filter(r => r.id > 0 && r.item.id > 0)
}

function buildSummaryFromRows(rows: SaleRecord[]): MiscSalesSummary {
  const s = emptySummary()
  for (const r of rows) {
    s.totalAmount += r.totalAmount
    s.items += r.quantity
    s.entries += 1
    s.categories[r.item.category].items += r.quantity
    s.categories[r.item.category].amount += r.totalAmount
    s.categories[r.item.category].entries += 1
  }
  return s
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function MiscSalePage() {
  const { data: session, status } = useSession()
  const user = session?.user as { id?: string; role?: string } | undefined
  const canManage = user?.role === 'ADMIN' || user?.role === 'CASHIER'

  // Core state
  const [allItems, setAllItems] = useState<MiscItem[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [summary, setSummary] = useState<MiscSalesSummary>(emptySummary)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [catFilter, setCatFilter] = useState<MiscCategory | 'ALL'>('ALL')
  const [loading, setLoading] = useState(false)
  const [charging, setCharging] = useState(false)
  const [flash, setFlash] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)

  // Date-range summary
  const [showRange, setShowRange] = useState(false)
  const [rangeFrom, setRangeFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10)
  })
  const [rangeTo, setRangeTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [rangeSummary, setRangeSummary] = useState<RangeSummary | null>(null)
  const [rangeLoading, setRangeLoading] = useState(false)

  // Barcode scan
  const [barcode, setBarcode] = useState('')
  const barcodeRef = useRef<HTMLInputElement>(null)
  const loadSeqRef = useRef(0)

  // Item management
  const [showManage, setShowManage] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', category: 'CIGARETTES' as MiscCategory, unit: 'pcs' as MiscUnit, price: '', barcode: '' })
  const [editItem, setEditItem] = useState<MiscItem | null>(null)
  const [editForm, setEditForm] = useState({ name: '', category: 'CIGARETTES' as MiscCategory, unit: 'pcs' as MiscUnit, price: '' })
  const [savingItem, setSavingItem] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)

  // ── Flash ───────────────────────────────────────────────────────────────────

  function showFlash(msg: string, type: 'ok' | 'err') {
    setFlash({ msg, type })
    setTimeout(() => setFlash(null), 2500)
  }

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch('/api/misc-items', { cache: 'no-store' })
      if (!res.ok) return
      const data: unknown = await res.json()
      setAllItems(Array.isArray(data) ? (data as MiscItem[]).map(i => ({ ...i, price: Number(i.price) })) : [])
    } catch { /* silent */ }
  }, [])

  const loadSales = useCallback(async () => {
    const run = ++loadSeqRef.current
    setLoading(true)
    try {
      const res = await fetch(`/api/misc-sales?date=${encodeURIComponent(date)}`, { cache: 'no-store' })
      const data: unknown = await res.json().catch(() => null)
      if (run !== loadSeqRef.current) return
      if (!res.ok) { setSales([]); setSummary(emptySummary()); return }
      const payload = (data && typeof data === 'object') ? data as Record<string, unknown> : {}
      const rows = normalizeSalesRows(payload.rows ?? data)
      setSales(rows)
      setSummary(buildSummaryFromRows(rows))
    } catch {
      if (run !== loadSeqRef.current) return
      setSales([]); setSummary(emptySummary())
    } finally {
      if (run === loadSeqRef.current) setLoading(false)
    }
  }, [date])

  useEffect(() => { if (status === 'authenticated') { void loadItems(); void loadSales() } }, [status, loadItems, loadSales])
  useEffect(() => { if (status === 'authenticated') void loadSales() }, [date, status, loadSales])
  useEffect(() => {
    if (status !== 'authenticated') return
    const id = setInterval(() => void loadSales(), 30_000)
    return () => clearInterval(id)
  }, [status, loadSales])
  useEffect(() => {
    const h = () => void loadSales()
    window.addEventListener('misc-sales:updated', h)
    return () => window.removeEventListener('misc-sales:updated', h)
  }, [loadSales])

  const loadRangeSummary = useCallback(async () => {
    setRangeLoading(true)
    try {
      const res = await fetch(`/api/misc-sales?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`, { cache: 'no-store' })
      if (!res.ok) { setRangeSummary(null); return }
      const data = await res.json() as RangeSummary
      setRangeSummary(data)
    } catch { setRangeSummary(null) }
    finally { setRangeLoading(false) }
  }, [rangeFrom, rangeTo])

  useEffect(() => {
    if (showRange && status === 'authenticated') void loadRangeSummary()
  }, [showRange, rangeFrom, rangeTo, status, loadRangeSummary])

  // ── Cart ────────────────────────────────────────────────────────────────────

  function addToCart(item: MiscItem) {
    setCart(prev => {
      const idx = prev.findIndex(c => c.item.id === item.id)
      if (idx >= 0) return prev.map((c, i) => i === idx ? { ...c, quantity: c.quantity + 1 } : c)
      return [...prev, { item, quantity: 1 }]
    })
  }

  function setQty(idx: number, qty: number) {
    if (qty <= 0) setCart(prev => prev.filter((_, i) => i !== idx))
    else setCart(prev => prev.map((c, i) => i === idx ? { ...c, quantity: qty } : c))
  }

  const cartTotal = cart.reduce((s, c) => s + c.item.price * c.quantity, 0)
  const cartQty = cart.reduce((s, c) => s + c.quantity, 0)
  const cartInCart = (id: number) => cart.find(c => c.item.id === id)?.quantity ?? 0

  // ── Barcode scan ────────────────────────────────────────────────────────────

  async function handleScan() {
    const bc = barcode.trim()
    if (!bc) return
    setBarcode('')

    // First check locally (already loaded)
    const local = allItems.find(i => i.barcode === bc)
    if (local) { addToCart(local); barcodeRef.current?.focus(); return }

    // Fallback: API lookup
    const res = await fetch(`/api/misc-items?barcode=${encodeURIComponent(bc)}`)
    const item: MiscItem | null = await res.json().catch(() => null)
    if (!item) {
      showFlash('Item not found. Add it from the catalogue below.', 'err')
      barcodeRef.current?.focus()
      return
    }
    addToCart({ ...item, price: Number(item.price) })
    barcodeRef.current?.focus()
  }

  // ── Charge ──────────────────────────────────────────────────────────────────

  async function charge() {
    if (cart.length === 0 || charging) return
    setCharging(true)
    try {
      const res = await fetch('/api/misc-sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffId: Number(user?.id ?? 0),
          saleDate: date,
          items: cart.map(c => ({ itemId: c.item.id, quantity: c.quantity })),
        }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { showFlash(data.error ?? 'Failed to record sale', 'err'); return }
      setCart([])
      showFlash(`Sale recorded — ${rupee(cartTotal)}`, 'ok')
      await loadSales()
      window.dispatchEvent(new Event('misc-sales:updated'))
    } catch { showFlash('Failed to record sale', 'err') }
    finally { setCharging(false); barcodeRef.current?.focus() }
  }

  // ── Item CRUD ────────────────────────────────────────────────────────────────

  async function saveNewItem() {
    const price = Number(addForm.price)
    if (!addForm.name.trim()) { showFlash('Name is required', 'err'); return }
    if (!Number.isFinite(price) || price <= 0) { showFlash('Valid price is required', 'err'); return }

    setSavingItem(true)
    const res = await fetch('/api/misc-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: addForm.name.trim(),
        category: addForm.category,
        unit: addForm.unit,
        price,
        barcode: addForm.barcode.trim() || null,
      }),
    })
    setSavingItem(false)
    const data = await res.json().catch(() => ({})) as { error?: string }
    if (!res.ok) { showFlash(data.error ?? 'Failed to add item', 'err'); return }
    setAddForm({ name: '', category: 'CIGARETTES', unit: 'pcs', price: '', barcode: '' })
    showFlash('Item added', 'ok')
    await loadItems()
  }

  function openEdit(item: MiscItem) {
    setEditItem(item)
    setEditForm({ name: item.name, category: item.category, unit: item.unit, price: String(item.price) })
  }

  async function saveEdit() {
    if (!editItem) return
    const price = Number(editForm.price)
    if (!editForm.name.trim()) { showFlash('Name required', 'err'); return }
    if (!Number.isFinite(price) || price <= 0) { showFlash('Valid price required', 'err'); return }

    setSavingItem(true)
    const res = await fetch('/api/misc-items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editItem.id, name: editForm.name.trim(), category: editForm.category, unit: editForm.unit, price }),
    })
    setSavingItem(false)
    const data = await res.json().catch(() => ({})) as { error?: string }
    if (!res.ok) { showFlash(data.error ?? 'Failed to save', 'err'); return }

    // Update cart if this item is in it
    setCart(prev => prev.map(c => c.item.id === editItem.id
      ? { ...c, item: { ...c.item, name: editForm.name.trim(), category: editForm.category, unit: editForm.unit, price } }
      : c))
    setEditItem(null)
    showFlash('Item updated', 'ok')
    await loadItems()
  }

  async function deleteItem(id: number) {
    const res = await fetch('/api/misc-items', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setDeleteConfirmId(null)
    const data = await res.json().catch(() => ({})) as { error?: string }
    if (!res.ok) { showFlash(data.error ?? 'Failed to delete', 'err'); return }
    setCart(prev => prev.filter(c => c.item.id !== id))
    showFlash('Item deleted', 'ok')
    await loadItems()
  }

  // ── Derived data ─────────────────────────────────────────────────────────────

  const filteredItems = catFilter === 'ALL' ? allItems : allItems.filter(i => i.category === catFilter)

  const tally = Object.values(
    sales.reduce<Record<string, { name: string; category: MiscCategory; unit: MiscUnit; qty: number; amount: number }>>(
      (acc, s) => {
        const key = String(s.item.id)
        if (!acc[key]) acc[key] = { name: s.item.name, category: s.item.category, unit: s.item.unit ?? 'pcs', qty: 0, amount: 0 }
        acc[key].qty += s.quantity
        acc[key].amount += s.totalAmount
        return acc
      }, {}
    )
  ).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-4">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Misc Sales</h1>
          <p className="text-slate-400 text-xs mt-0.5">Cashier revenue — separate from liquor</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date" value={date}
            onChange={e => setDate(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          <button
            onClick={() => setShowRange(v => !v)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
              showRange ? 'bg-indigo-700 text-white border-indigo-700' : 'bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50'
            }`}
          >
            {showRange ? 'Hide Range' : 'Range Summary'}
          </button>
          {canManage && (
            <button
              onClick={() => setShowManage(v => !v)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                showManage ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {showManage ? 'Done Managing' : 'Manage Items'}
            </button>
          )}
        </div>
      </div>

      {/* ── Date-range summary panel ───────────────────────────────────────── */}
      {showRange && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-indigo-100/60 border-b border-indigo-200 flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-sm font-bold text-indigo-800">Range Summary</h2>
            <div className="flex items-center gap-2 text-sm">
              <input
                type="date" value={rangeFrom}
                onChange={e => setRangeFrom(e.target.value)}
                className="px-3 py-1.5 border border-indigo-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
              />
              <span className="text-indigo-400 font-semibold">→</span>
              <input
                type="date" value={rangeTo}
                onChange={e => setRangeTo(e.target.value)}
                className="px-3 py-1.5 border border-indigo-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
              />
              <button
                onClick={() => void loadRangeSummary()}
                disabled={rangeLoading}
                className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {rangeLoading ? '…' : 'Load'}
              </button>
            </div>
          </div>

          {rangeLoading && (
            <div className="flex items-center justify-center h-20">
              <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!rangeLoading && rangeSummary && (
            <div className="px-5 py-4 space-y-4">
              {/* Totals row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white border border-indigo-100 rounded-xl p-4 text-center">
                  <p className="text-xs font-bold text-indigo-400 uppercase tracking-wide mb-1">Total Revenue</p>
                  <p className="text-2xl font-black text-indigo-900">{rupee(rangeSummary.totalAmount)}</p>
                </div>
                <div className="bg-white border border-indigo-100 rounded-xl p-4 text-center">
                  <p className="text-xs font-bold text-indigo-400 uppercase tracking-wide mb-1">Items Sold</p>
                  <p className="text-2xl font-black text-indigo-900">{rangeSummary.totalItems}</p>
                </div>
                <div className="bg-white border border-indigo-100 rounded-xl p-4 text-center">
                  <p className="text-xs font-bold text-indigo-400 uppercase tracking-wide mb-1">Transactions</p>
                  <p className="text-2xl font-black text-indigo-900">{rangeSummary.totalEntries}</p>
                </div>
              </div>

              {/* By payment mode */}
              {rangeSummary.byMode.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-indigo-500 uppercase tracking-wide mb-2">By Payment Mode</p>
                  <div className="flex flex-wrap gap-2">
                    {rangeSummary.byMode.map(m => (
                      <div key={m.mode} className="bg-white border border-indigo-100 rounded-lg px-4 py-2 flex items-center gap-3">
                        <span className="text-xs font-bold text-indigo-400 uppercase">{m.mode}</span>
                        <span className="font-bold text-slate-800">{rupee(m.amount)}</span>
                        <span className="text-xs text-slate-400">{m.qty} items</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* By category */}
              <div>
                <p className="text-xs font-bold text-indigo-500 uppercase tracking-wide mb-2">By Category</p>
                <div className="grid grid-cols-3 gap-3">
                  {(Object.entries(rangeSummary.categories) as [MiscCategory, { amount: number; items: number; entries: number }][]).map(([cat, c]) => {
                    const colors = CAT_COLORS[cat]
                    return (
                      <div key={cat} className={`${colors.bg} border ${colors.border} rounded-xl p-4`}>
                        <p className={`text-[10px] font-bold uppercase tracking-wider ${colors.text} mb-1`}>{CAT_LABEL[cat]}</p>
                        <p className="text-xl font-black text-slate-900">{c.items} <span className="text-xs font-normal text-slate-400">sold</span></p>
                        <p className={`text-sm font-bold ${colors.text}`}>{rupee(c.amount)}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{c.entries} entries</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {!rangeLoading && !rangeSummary && (
            <div className="px-5 py-8 text-center text-sm text-indigo-400">No data for this range.</div>
          )}
        </div>
      )}

      {/* ── Flash ───────────────────────────────────────────────────────────── */}
      {flash && (
        <div className={`px-4 py-2.5 rounded-lg text-sm font-semibold border ${
          flash.type === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          {flash.msg}
        </div>
      )}

      {/* ── Manage Items panel ───────────────────────────────────────────────── */}
      {showManage && canManage && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700">Item Catalogue</h2>
            <span className="text-xs text-slate-400">{allItems.length} items</span>
          </div>

          {/* Add new item form */}
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/40">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Add New Item</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              <input
                placeholder="Name *"
                value={addForm.name}
                onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                className="col-span-2 px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={addForm.category}
                onChange={e => setAddForm(f => ({ ...f, category: e.target.value as MiscCategory }))}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
              </select>
              <select
                value={addForm.unit}
                onChange={e => setAddForm(f => ({ ...f, unit: e.target.value as MiscUnit }))}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {UNIT_OPTIONS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
              <input
                type="number" placeholder="Price ₹ *"
                value={addForm.price}
                onChange={e => setAddForm(f => ({ ...f, price: e.target.value }))}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                placeholder="Barcode (optional)"
                value={addForm.barcode}
                onChange={e => setAddForm(f => ({ ...f, barcode: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && saveNewItem()}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
            <button
              onClick={saveNewItem} disabled={savingItem}
              className="mt-2 px-5 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {savingItem ? 'Adding...' : '+ Add Item'}
            </button>
          </div>

          {/* Items table */}
          {allItems.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-400">No items yet. Add one above.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60">
                    <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-400">Name</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400">Category</th>
                    <th className="text-center px-4 py-2.5 text-xs font-semibold text-slate-400">Unit</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-400">Price</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400 font-mono">Barcode</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {allItems.map(item => (
                    <tr key={item.id} className="hover:bg-slate-50 group">
                      <td className="px-5 py-3 font-medium text-slate-800">{item.name}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${CAT_COLORS[item.category].badge}`}>
                          {CAT_LABEL[item.category]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-slate-500">{item.unit ?? 'pcs'}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-800">{rupee(item.price)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{item.barcode ?? '—'}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openEdit(item)}
                            className="px-2.5 py-1 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg">
                            Edit
                          </button>
                          <button onClick={() => setDeleteConfirmId(item.id)}
                            className="px-2.5 py-1 text-xs font-bold text-red-500 bg-red-50 hover:bg-red-100 rounded-lg">
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Main grid: products + cart ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── Left: product selector ─────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-3">

          {/* Barcode scan */}
          <div className="flex gap-2">
            <input
              ref={barcodeRef}
              value={barcode}
              onChange={e => setBarcode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleScan()}
              placeholder="Scan barcode and press Enter…"
              className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 font-mono bg-white"
              autoFocus
            />
            <button onClick={handleScan}
              className="px-4 py-2.5 bg-slate-700 text-white text-sm font-bold rounded-lg hover:bg-slate-800 transition-colors">
              Scan
            </button>
          </div>

          {/* Category filter tabs */}
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
            {(['ALL', ...CATEGORIES] as const).map(c => (
              <button
                key={c}
                onClick={() => setCatFilter(c)}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-colors ${
                  catFilter === c ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {c === 'ALL' ? 'All' : CAT_LABEL[c]}
                {c !== 'ALL' && (
                  <span className="ml-1 text-[10px] text-slate-400">
                    ({allItems.filter(i => i.category === c).length})
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Product grid */}
          {allItems.length === 0 ? (
            <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-sm">
              No misc items yet.
              {canManage && (
                <button onClick={() => setShowManage(true)} className="block mx-auto mt-2 text-blue-600 font-semibold hover:underline">
                  Add items from Manage Items
                </button>
              )}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-sm">
              No {catFilter !== 'ALL' ? CAT_LABEL[catFilter] : ''} items yet.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {filteredItems.map(item => {
                const inCart = cartInCart(item.id)
                const colors = CAT_COLORS[item.category]
                return (
                  <button
                    key={item.id}
                    onClick={() => addToCart(item)}
                    className={`relative text-left p-4 rounded-xl border-2 transition-all hover:shadow-md active:scale-95 ${
                      inCart > 0
                        ? `${colors.bg} ${colors.border} shadow-sm`
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {inCart > 0 && (
                      <span className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${colors.badge}`}>
                        {inCart}
                      </span>
                    )}
                    <p className={`text-[10px] font-bold uppercase tracking-wide mb-1 ${inCart > 0 ? colors.text : 'text-slate-400'}`}>
                      {CAT_LABEL[item.category]}
                    </p>
                    <p className="font-bold text-slate-800 text-sm leading-snug">{item.name}</p>
                    <div className="flex items-end justify-between mt-2">
                      <span className="text-xs text-slate-400">per {item.unit ?? 'pcs'}</span>
                      <span className="text-base font-black text-slate-900">{rupee(item.price)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Right: cart ───────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-700">Current Bill</h2>
              {cart.length > 0 && (
                <button onClick={() => setCart([])} className="text-xs text-red-400 hover:text-red-600 font-semibold">
                  Clear all
                </button>
              )}
            </div>

            {cart.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-400">
                Tap an item to add it
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {cart.map((c, i) => (
                  <div key={i} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{c.item.name}</p>
                        <p className="text-xs text-slate-400">{rupee(c.item.price)} / {c.item.unit ?? 'pcs'}</p>
                      </div>
                      <button onClick={() => setQty(i, 0)} className="text-slate-300 hover:text-red-500 text-lg leading-none mt-0.5">×</button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setQty(i, c.quantity - 1)}
                          className="w-7 h-7 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-100 font-bold flex items-center justify-center">−</button>
                        <input
                          type="number" min={1}
                          value={c.quantity}
                          onChange={e => setQty(i, Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-10 text-center text-sm font-bold border border-slate-200 rounded-lg py-1 outline-none focus:ring-2 focus:ring-blue-400"
                        />
                        <button onClick={() => setQty(i, c.quantity + 1)}
                          className="w-7 h-7 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-100 font-bold flex items-center justify-center">+</button>
                      </div>
                      <span className="font-black text-slate-900">{rupee(c.item.price * c.quantity)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {cart.length > 0 && (
              <div className="px-4 py-4 bg-emerald-50 border-t border-emerald-100">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-emerald-700 font-semibold">{cartQty} {cartQty === 1 ? 'item' : 'items'}</span>
                  <span className="text-lg font-black text-emerald-800">{rupee(cartTotal)}</span>
                </div>
                <button
                  onClick={charge} disabled={charging}
                  className="w-full py-3 bg-emerald-600 text-white font-black rounded-xl text-sm hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                >
                  {charging ? 'Recording…' : `Charge ${rupee(cartTotal)}`}
                </button>
              </div>
            )}
          </div>

          {/* Cashier note */}
          <div className="px-4 py-3 bg-cyan-50 border border-cyan-200 rounded-xl text-xs text-cyan-700 text-center">
            Misc revenue — cashier float only<br />
            <span className="text-cyan-500">Not included in owner liquor totals</span>
          </div>
        </div>
      </div>

      {/* ── Category summary cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {CATEGORIES.map(cat => {
          const c = summary.categories[cat]
          const colors = CAT_COLORS[cat]
          return (
            <div key={cat} className={`${colors.bg} border ${colors.border} rounded-xl p-4`}>
              <p className={`text-[10px] font-bold uppercase tracking-wider ${colors.text} mb-1`}>
                {CAT_LABEL[cat]}
              </p>
              <p className="text-2xl font-black text-slate-900">{c.items}
                <span className="text-sm font-normal text-slate-400 ml-1">sold</span>
              </p>
              <p className={`text-sm font-bold ${colors.text} mt-0.5`}>{rupee(c.amount)}</p>
            </div>
          )
        })}
      </div>

      {/* ── Daily total ──────────────────────────────────────────────────────── */}
      {summary.totalAmount > 0 && (
        <div className="bg-cyan-600 text-white rounded-xl px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold opacity-80 uppercase tracking-wider">Total Misc Revenue</p>
            <p className="text-2xl font-black">{rupee(summary.totalAmount)}</p>
          </div>
          <div className="text-right text-sm opacity-80">
            <p>{summary.items} items · {summary.entries} entries</p>
            <p className="text-xs mt-0.5">Cashier keeps this</p>
          </div>
        </div>
      )}

      {/* ── Product-wise tally ───────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center h-20">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tally.length > 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700">Product-wise Tally</h2>
            <span className="text-xs text-slate-400">
              {new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60">
                <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-400">Item</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-slate-400">Category</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-slate-400">Qty Sold</th>
                <th className="text-right px-5 py-2.5 text-xs font-semibold text-slate-400">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {tally.map((r, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-800">{r.name}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${CAT_COLORS[r.category].badge}`}>
                      {CAT_LABEL[r.category]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center font-bold text-slate-700">
                    {r.qty} <span className="text-xs font-normal text-slate-400">{r.unit}</span>
                  </td>
                  <td className="px-5 py-3 text-right font-bold text-slate-900">{rupee(r.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t border-slate-200 font-bold">
                <td className="px-5 py-2.5 text-slate-600" colSpan={2}>Total</td>
                <td className="px-4 py-2.5 text-center text-slate-800">{summary.items}</td>
                <td className="px-5 py-2.5 text-right text-slate-900">{rupee(summary.totalAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-sm">
          No misc sales recorded for this date.
        </div>
      )}

      {/* ── Edit item modal ──────────────────────────────────────────────────── */}
      {editItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-96 shadow-xl">
            <h2 className="text-base font-bold text-slate-800 mb-1">Edit Item</h2>
            <p className="text-xs text-slate-400 mb-4">Barcode: <span className="font-mono">{editItem.barcode ?? 'none'}</span></p>
            <div className="space-y-3">
              <input
                autoFocus value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Product name"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select value={editForm.category}
                onChange={e => setEditForm(f => ({ ...f, category: e.target.value as MiscCategory }))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
              </select>
              <select value={editForm.unit}
                onChange={e => setEditForm(f => ({ ...f, unit: e.target.value as MiscUnit }))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                {UNIT_OPTIONS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
              <input type="number" value={editForm.price}
                onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && saveEdit()}
                placeholder="Price per unit (₹)"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setEditItem(null)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-500 rounded-lg text-sm font-semibold hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={savingItem}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
                {savingItem ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm modal ──────────────────────────────────────────────── */}
      {deleteConfirmId !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-80 shadow-xl">
            <h2 className="text-base font-bold text-slate-800 mb-2">Delete Item?</h2>
            <p className="text-sm text-slate-500 mb-4">
              {allItems.find(i => i.id === deleteConfirmId)?.name} will be removed from the catalogue.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirmId(null)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-500 rounded-lg text-sm font-semibold hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={() => deleteItem(deleteConfirmId)}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
