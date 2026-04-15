import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Search, Barcode, Plus, Minus, Trash2, CreditCard, Banknote, Smartphone,
  ShoppingBag, CheckCircle, AlertCircle, X, XCircle, Package, Settings2, Pencil,
} from 'lucide-react'
import type { Product, MiscItem, DailyTotals, MiscTotals } from '../types'

// ── Types ─────────────────────────────────────────────────────────────────────

type CartItem = {
  key: string           // unique per cart line
  label: string
  unitPrice: number
  quantity: number
  isMisc: boolean
  // for regular items:
  product?: Product
  // for misc items:
  miscItemId?: number   // undefined for one-off items
  miscItemName?: string
}

type PaymentMode = 'CASH' | 'CARD' | 'UPI' | 'SPLIT'

// ── Constants ─────────────────────────────────────────────────────────────────

const LIQUOR_CATEGORIES = ['ALL', 'BEER', 'WHISKY', 'BRANDY', 'RUM', 'VODKA', 'GIN', 'WINE', 'PREMIX', 'BEVERAGE']
const fmtRs = (n: number) => `₹${n.toFixed(2)}`

// ── Size badge ────────────────────────────────────────────────────────────────

function SizeBadge({ ml }: { ml: number }) {
  let label: string
  let cls: string
  if (ml <= 60)        { label = `${ml}ml`;  cls = 'bg-purple-900 text-purple-300 border-purple-700' }
  else if (ml <= 90)   { label = '90ml';     cls = 'bg-violet-900 text-violet-300 border-violet-700' }
  else if (ml <= 180)  { label = '180ml';    cls = 'bg-blue-900   text-blue-300   border-blue-700'   }
  else if (ml <= 375)  { label = '375ml';    cls = 'bg-cyan-900   text-cyan-300   border-cyan-700'   }
  else if (ml <= 500)  { label = '500ml';    cls = 'bg-teal-900   text-teal-300   border-teal-700'   }
  else if (ml <= 750)  { label = '750ml';    cls = 'bg-amber-900  text-amber-300  border-amber-700'  }
  else                 { label = `${ml}ml`;  cls = 'bg-red-900    text-red-300    border-red-700'    }
  return <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold leading-none ${cls}`}>{label}</span>
}

// ── Manage Misc Items modal ───────────────────────────────────────────────────

type ManageModalProps = {
  items: MiscItem[]
  onClose: () => void
  onRefresh: () => void
}

function ManageMiscModal({ items, onClose, onRefresh }: ManageModalProps) {
  const [name, setName]       = useState('')
  const [price, setPrice]     = useState('')
  const [barcode, setBarcode] = useState('')
  const [editId, setEditId]   = useState<number | null>(null)
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState('')

  function startEdit(item: MiscItem) {
    setEditId(item.id)
    setName(item.name)
    setPrice(String(item.price))
    setBarcode(item.barcode ?? '')
    setErr('')
  }

  function resetForm() {
    setEditId(null); setName(''); setPrice(''); setBarcode(''); setErr('')
  }

  async function handleSave() {
    const p = parseFloat(price)
    if (!name.trim())   { setErr('Name is required'); return }
    if (isNaN(p) || p <= 0) { setErr('Enter a valid price'); return }
    setSaving(true)
    const res = await window.posAPI.saveMiscItem({
      id: editId ?? undefined,
      name: name.trim(),
      price: p,
      barcode: barcode.trim() || null,
    })
    setSaving(false)
    if (!res.ok) { setErr(res.error ?? 'Save failed'); return }
    resetForm()
    onRefresh()
  }

  async function handleDelete(id: number) {
    await window.posAPI.deleteMiscItem(id)
    onRefresh()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-xl border border-slate-600 w-[480px] max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
          <span className="font-semibold text-slate-100">Manage Misc Items</span>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18} /></button>
        </div>

        {/* Existing items */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5">
          {items.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-6">No items yet. Add one below.</p>
          )}
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-2 bg-slate-750 bg-slate-900/50 rounded-lg px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-200 truncate">{item.name}</div>
                <div className="text-xs text-slate-400">
                  {fmtRs(item.price)}
                  {item.barcode && <span className="ml-2 text-slate-500">#{item.barcode}</span>}
                </div>
              </div>
              <button onClick={() => startEdit(item)} className="text-slate-400 hover:text-indigo-400 p-1">
                <Pencil size={13} />
              </button>
              <button onClick={() => handleDelete(item.id)} className="text-slate-500 hover:text-red-400 p-1">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>

        {/* Add / Edit form */}
        <div className="border-t border-slate-700 px-5 py-4 space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            {editId ? 'Edit item' : 'Add new item'}
          </p>
          {err && <p className="text-xs text-red-400">{err}</p>}
          <div className="flex gap-2">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Item name (e.g. Cigarette)"
              className="flex-1 bg-slate-700 text-slate-100 rounded px-2.5 py-1.5 text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <input
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder="₹ Price"
              type="number"
              className="w-24 bg-slate-700 text-slate-100 rounded px-2.5 py-1.5 text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <input
            value={barcode}
            onChange={e => setBarcode(e.target.value)}
            placeholder="Barcode (optional — scan or type)"
            className="w-full bg-slate-700 text-slate-100 rounded px-2.5 py-1.5 text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Saving…' : editId ? 'Update' : 'Add Item'}
            </button>
            {editId && (
              <button onClick={resetForm} className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm">
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── One-off item modal ────────────────────────────────────────────────────────

type OneOffModalProps = {
  onAdd: (name: string, price: number) => void
  onClose: () => void
}

function OneOffModal({ onAdd, onClose }: OneOffModalProps) {
  const [name, setName]   = useState('')
  const [price, setPrice] = useState('')
  const [err, setErr]     = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  function handleAdd() {
    const p = parseFloat(price)
    if (!name.trim())       { setErr('Enter item name'); return }
    if (isNaN(p) || p <= 0) { setErr('Enter a valid price'); return }
    onAdd(name.trim(), p)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-xl border border-slate-600 w-80 shadow-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-100 text-sm">Custom Item</span>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <input
          ref={nameRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="Item name"
          className="w-full bg-slate-700 text-slate-100 rounded px-2.5 py-2 text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <input
          value={price}
          onChange={e => setPrice(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="₹ Price"
          type="number"
          className="w-full bg-slate-700 text-slate-100 rounded px-2.5 py-2 text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          onClick={handleAdd}
          className="w-full py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium"
        >
          Add to Cart
        </button>
      </div>
    </div>
  )
}

// ── Main POS screen ───────────────────────────────────────────────────────────

export default function POS() {
  const [products, setProducts]   = useState<Product[]>([])
  const [miscItems, setMiscItems] = useState<MiscItem[]>([])
  const [staff, setStaff]         = useState<{ id: number; name: string; role: string }[]>([])
  const [search, setSearch]       = useState('')
  const [category, setCategory]   = useState('ALL')
  const [cart, setCart]           = useState<CartItem[]>([])
  const [totals, setTotals]       = useState<DailyTotals | null>(null)
  const [miscTotals, setMiscTotals] = useState<MiscTotals | null>(null)
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('CASH')
  const [cashAmount, setCashAmount]   = useState('')
  const [cardAmount, setCardAmount]   = useState('')
  const [upiAmount, setUpiAmount]     = useState('')
  const [customerName, setCustomerName] = useState('')
  const [activeStaffId, setActiveStaffId] = useState<number | null>(null)
  const [isSubmitting, setIsSubmitting]   = useState(false)
  const [toast, setToast]         = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const [barcodeBuffer, setBarcodeBuffer] = useState('')
  const [showManage, setShowManage]       = useState(false)
  const [showOneOff, setShowOneOff]       = useState(false)
  const searchRef     = useRef<HTMLInputElement>(null)
  const barcodeTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const staffInit     = useRef(false)
  const oneOffCounter = useRef(0)

  // ── Data loading ─────────────────────────────────────────────────────────────

  const loadMiscItems = useCallback(async () => {
    const items = await window.posAPI.getMiscItems()
    setMiscItems(items)
  }, [])

  const initialLoad = useCallback(async () => {
    const [prods, stf, tot, miscTot, miscItms] = await Promise.all([
      window.posAPI.getProducts(),
      window.posAPI.getStaff(),
      window.posAPI.getTodayTotals(),
      window.posAPI.getMiscTotalsToday(),
      window.posAPI.getMiscItems(),
    ])
    setProducts(prods)
    setStaff(stf)
    setTotals(tot)
    setMiscTotals(miscTot)
    setMiscItems(miscItms)
    if (!staffInit.current && stf.length > 0) {
      const eligible = stf.filter(s => ['CASHIER', 'SUPPLIER'].includes(s.role))
      setActiveStaffId(eligible.length > 0 ? eligible[0].id : stf[0].id)
      staffInit.current = true
    }
  }, [])

  const refreshTotals = useCallback(async () => {
    const [tot, miscTot] = await Promise.all([
      window.posAPI.getTodayTotals(),
      window.posAPI.getMiscTotalsToday(),
    ])
    setTotals(tot)
    setMiscTotals(miscTot)
  }, [])

  useEffect(() => {
    initialLoad()
    const unsub = window.posAPI.onSyncEvent(event => {
      if (event === 'push_complete' || event === 'pull_complete') refreshTotals()
    })
    return () => unsub()
  }, [initialLoad, refreshTotals])

  // ── Barcode scanner ───────────────────────────────────────────────────────────

  useEffect(() => {
    const handleKey = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' && target !== searchRef.current) return

      if (e.key === 'Enter') {
        if (barcodeBuffer.length >= 4) await handleBarcodeInput(barcodeBuffer)
        setBarcodeBuffer('')
        if (barcodeTimer.current) clearTimeout(barcodeTimer.current)
      } else if (e.key.length === 1) {
        setBarcodeBuffer(prev => prev + e.key)
        if (barcodeTimer.current) clearTimeout(barcodeTimer.current)
        barcodeTimer.current = setTimeout(() => setBarcodeBuffer(''), 500)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
      if (barcodeTimer.current) clearTimeout(barcodeTimer.current)
    }
  }, [barcodeBuffer])

  async function handleBarcodeInput(barcode: string) {
    // Check regular products first, then misc items
    const product = await window.posAPI.getProductByBarcode(barcode)
    if (product) { addProductToCart(product); return }

    const misc = await window.posAPI.getMiscItemByBarcode(barcode)
    if (misc) { addMiscToCart(misc); return }

    showToast('err', `Barcode not found: ${barcode}`)
  }

  // ── Filtered products ─────────────────────────────────────────────────────────

  const isMiscTab = category === 'MISC'

  const filteredProducts = useMemo(() => {
    if (isMiscTab) return []
    return products.filter(p => {
      const matchCat = category === 'ALL' || p.category === category
      const s = search.toLowerCase()
      const matchSearch = !s || p.name.toLowerCase().includes(s) ||
        p.item_code.toLowerCase().includes(s) || (p.barcode ?? '').includes(s)
      return matchCat && matchSearch
    })
  }, [products, category, search, isMiscTab])

  const filteredMisc = useMemo(() => {
    if (!isMiscTab) return []
    const s = search.toLowerCase()
    return miscItems.filter(m => !s || m.name.toLowerCase().includes(s))
  }, [miscItems, search, isMiscTab])

  const eligibleStaff = useMemo(
    () => staff.filter(s => ['CASHIER', 'SUPPLIER'].includes(s.role)),
    [staff]
  )

  const activeStaff = useMemo(
    () => staff.find(s => s.id === activeStaffId),
    [staff, activeStaffId]
  )

  // ── Cart operations ───────────────────────────────────────────────────────────

  function addProductToCart(product: Product) {
    const key = `prod-${product.size_id}`
    setCart(prev => {
      const existing = prev.find(i => i.key === key)
      if (existing) return prev.map(i => i.key === key ? { ...i, quantity: i.quantity + 1 } : i)
      return [...prev, { key, label: product.name, unitPrice: product.selling_price, quantity: 1, isMisc: false, product }]
    })
  }

  function addMiscToCart(misc: MiscItem) {
    const key = `misc-${misc.id}`
    setCart(prev => {
      const existing = prev.find(i => i.key === key)
      if (existing) return prev.map(i => i.key === key ? { ...i, quantity: i.quantity + 1 } : i)
      return [...prev, { key, label: misc.name, unitPrice: misc.price, quantity: 1, isMisc: true, miscItemId: misc.id, miscItemName: misc.name }]
    })
  }

  function addOneOffToCart(name: string, price: number) {
    const key = `oneoff-${++oneOffCounter.current}`
    setCart(prev => [...prev, { key, label: name, unitPrice: price, quantity: 1, isMisc: true, miscItemName: name }])
  }

  function updateQty(key: string, delta: number) {
    setCart(prev =>
      prev.map(i => i.key === key ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i)
          .filter(i => i.quantity > 0)
    )
  }

  function removeFromCart(key: string) {
    setCart(prev => prev.filter(i => i.key !== key))
  }

  function voidCart() {
    setCart([])
    setCashAmount(''); setCardAmount(''); setUpiAmount('')
    setCustomerName(''); setPaymentMode('CASH')
  }

  const cartTotal     = cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const liquorTotal   = cart.filter(i => !i.isMisc).reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const miscCartTotal = cart.filter(i =>  i.isMisc).reduce((s, i) => s + i.unitPrice * i.quantity, 0)

  const splitTotal = parseFloat(cashAmount || '0') + parseFloat(cardAmount || '0') + parseFloat(upiAmount || '0')
  const splitDiff  = paymentMode === 'SPLIT' ? Math.abs(splitTotal - cartTotal) : 0
  const canSubmit  = cart.length > 0 && activeStaffId && (paymentMode !== 'SPLIT' || splitDiff < 0.01)

  // ── Toast ─────────────────────────────────────────────────────────────────────

  function showToast(type: 'ok' | 'err', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  // ── Checkout ──────────────────────────────────────────────────────────────────

  const handleCheckout = async () => {
    if (!canSubmit || isSubmitting) return
    setIsSubmitting(true)

    try {
      const liquorItems = cart.filter(i => !i.isMisc)
      const miscCartItems = cart.filter(i => i.isMisc)

      // Record regular liquor sales
      for (const item of liquorItems) {
        const result = await window.posAPI.insertSale({
          staff_id:        activeStaffId!,
          product_size_id: item.product!.size_id,
          product_name:    item.product!.name,
          size_ml:         item.product!.size_ml,
          quantity:        item.quantity,
          selling_price:   item.unitPrice,
          total_amount:    item.unitPrice * item.quantity,
          payment_mode:    paymentMode,
          cash_amount: paymentMode === 'CASH'  ? cartTotal :
                       paymentMode === 'SPLIT' ? parseFloat(cashAmount || '0') : null,
          card_amount: paymentMode === 'CARD'  ? cartTotal :
                       paymentMode === 'SPLIT' ? parseFloat(cardAmount || '0') : null,
          upi_amount:  paymentMode === 'UPI'   ? cartTotal :
                       paymentMode === 'SPLIT' ? parseFloat(upiAmount  || '0') : null,
          scan_method:   'MANUAL',
          customer_name: customerName || null,
        })
        if (!result.ok) throw new Error(result.error ?? 'Sale failed')
      }

      // Record misc sales (local only — cashier's earnings)
      for (const item of miscCartItems) {
        await window.posAPI.insertMiscSale({
          staff_id:     activeStaffId!,
          item_name:    item.miscItemName ?? item.label,
          quantity:     item.quantity,
          price:        item.unitPrice,
          total:        item.unitPrice * item.quantity,
          payment_mode: paymentMode,
        })
      }

      const savedTotal = cartTotal
      voidCart()
      showToast('ok', `Bill recorded — ${fmtRs(savedTotal)}`)
      refreshTotals()
    } catch (e) {
      showToast('err', String(e))
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const allTabs = [...LIQUOR_CATEGORIES, 'MISC']

  return (
    <div className="flex h-full bg-slate-900 overflow-hidden">

      {/* ── Left: product / misc list ── */}
      <div className="flex flex-col w-[55%] border-r border-slate-700">

        {/* Search bar */}
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-800 border-b border-slate-700">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={isMiscTab ? 'Search misc items…' : 'Search product or scan barcode…'}
              className="w-full bg-slate-700 text-slate-100 placeholder-slate-400 rounded pl-7 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                <X size={12} />
              </button>
            )}
          </div>
          <Barcode size={16} className="text-slate-400" />
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 px-2 py-2 overflow-x-auto bg-slate-800 border-b border-slate-700 flex-shrink-0">
          {allTabs.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors
                ${category === cat
                  ? cat === 'MISC' ? 'bg-orange-600 text-white' : 'bg-indigo-600 text-white'
                  : cat === 'MISC' ? 'bg-orange-900/40 text-orange-300 hover:bg-orange-800/50'
                                   : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              {cat === 'MISC' ? '🛍 MISC' : cat}
            </button>
          ))}
        </div>

        {/* Product grid OR misc grid */}
        {isMiscTab ? (
          <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
            {/* Misc header */}
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs text-slate-400">
                Cashier items — {activeStaff?.name ?? 'select counter'}'s stock
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setShowOneOff(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs"
                >
                  <Plus size={12} /> Custom
                </button>
                <button
                  onClick={() => setShowManage(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs"
                >
                  <Settings2 size={12} /> Manage
                </button>
              </div>
            </div>

            {/* Misc item cards */}
            <div className="grid grid-cols-3 gap-2 content-start">
              {filteredMisc.map(item => (
                <button
                  key={item.id}
                  onClick={() => addMiscToCart(item)}
                  className="text-left p-2 rounded-lg border border-orange-800/50 bg-orange-950/30 hover:border-orange-500 hover:bg-orange-900/30 active:scale-95 transition-all text-xs"
                >
                  <div className="font-medium text-slate-200 line-clamp-2 leading-tight mb-1">{item.name}</div>
                  <div className="mb-1">
                    <span className="inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold leading-none bg-orange-900 text-orange-300 border-orange-700">
                      MISC
                    </span>
                  </div>
                  <div className="text-emerald-400 font-semibold mt-1">{fmtRs(item.price)}</div>
                </button>
              ))}

              {/* "Add custom" card */}
              <button
                onClick={() => setShowOneOff(true)}
                className="text-left p-2 rounded-lg border border-dashed border-slate-600 hover:border-slate-400 bg-slate-800/30 hover:bg-slate-800 active:scale-95 transition-all text-xs flex flex-col items-center justify-center gap-1 min-h-[80px] text-slate-500 hover:text-slate-300"
              >
                <Plus size={18} />
                <span>Custom item</span>
              </button>

              {filteredMisc.length === 0 && search && (
                <div className="col-span-3 text-center text-slate-500 py-8 text-sm">No items match</div>
              )}
              {miscItems.length === 0 && !search && (
                <div className="col-span-3 text-center text-slate-600 py-8 text-sm">
                  No saved items yet — click <strong>Manage</strong> to add cigarettes, cups, snacks…
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-2 grid grid-cols-3 gap-2 content-start scrollbar-thin">
            {filteredProducts.map(product => (
              <button
                key={product.size_id}
                onClick={() => addProductToCart(product)}
                disabled={product.stock <= 0}
                className={`text-left p-2 rounded-lg border transition-all text-xs
                  ${product.stock <= 0
                    ? 'opacity-40 cursor-not-allowed bg-slate-800 border-slate-700'
                    : 'bg-slate-800 border-slate-700 hover:border-indigo-500 hover:bg-slate-750 active:scale-95'}`}
              >
                <div className="font-medium text-slate-200 line-clamp-2 leading-tight mb-1">{product.name}</div>
                <div className="mb-1"><SizeBadge ml={product.size_ml} /></div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-emerald-400 font-semibold">{fmtRs(product.selling_price)}</span>
                  <span className={`text-xs ${product.stock < 5 ? 'text-amber-400' : 'text-slate-500'}`}>
                    {product.stock} btl
                  </span>
                </div>
              </button>
            ))}
            {filteredProducts.length === 0 && (
              <div className="col-span-3 text-center text-slate-500 py-12 text-sm">No products found</div>
            )}
          </div>
        )}

        {/* Today's summary footer */}
        {totals && (
          <div className="flex gap-3 px-3 py-2 bg-slate-800 border-t border-slate-700 text-xs text-slate-400 flex-shrink-0 flex-wrap">
            <span>{totals.bill_count} bills</span>
            <span>{totals.total_bottles} bottles</span>
            <span className="text-emerald-400 font-medium">{fmtRs(totals.gross_revenue)}</span>
            {miscTotals && miscTotals.misc_revenue > 0 && (
              <span className="text-orange-400">
                +{fmtRs(miscTotals.misc_revenue)} misc
              </span>
            )}
            <span className="ml-auto text-slate-500">{new Date().toLocaleDateString('en-IN')}</span>
          </div>
        )}
      </div>

      {/* ── Right: cart + checkout ── */}
      <div className="flex flex-col w-[45%]">

        {/* Counter selector + Void */}
        <div className="px-3 py-2 bg-slate-800 border-b border-slate-700 flex items-center gap-2">
          <span className="text-xs text-slate-400 whitespace-nowrap">Counter:</span>
          <select
            value={activeStaffId ?? ''}
            onChange={e => setActiveStaffId(parseInt(e.target.value))}
            className="flex-1 bg-slate-700 text-slate-200 text-xs rounded px-2 py-1 focus:outline-none"
          >
            {eligibleStaff.length === 0 && <option value="">No staff assigned</option>}
            {eligibleStaff.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {cart.length > 0 && (
            <button
              onClick={voidCart}
              title="Void Bill"
              className="flex items-center gap-1 px-2 py-1 rounded bg-red-900 hover:bg-red-800 text-red-300 text-xs font-medium transition-colors whitespace-nowrap"
            >
              <XCircle size={13} /> Void
            </button>
          )}
        </div>

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
              <ShoppingBag size={40} />
              <p className="text-sm">Cart is empty</p>
              <p className="text-xs text-slate-700">Select a product or scan a barcode</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {/* Group: liquor items */}
              {cart.filter(i => !i.isMisc).map(item => (
                <div key={item.key} className="flex items-center gap-2 bg-slate-800 rounded-lg p-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-200 truncate">{item.label}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <SizeBadge ml={item.product!.size_ml} />
                      <span className="text-xs text-slate-400">{fmtRs(item.unitPrice)} each</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => updateQty(item.key, -1)} className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-slate-300"><Minus size={12} /></button>
                    <span className="w-6 text-center text-sm font-medium text-white">{item.quantity}</span>
                    <button onClick={() => updateQty(item.key, +1)} className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-slate-300"><Plus size={12} /></button>
                  </div>
                  <div className="text-sm font-semibold text-emerald-400 w-16 text-right">{fmtRs(item.unitPrice * item.quantity)}</div>
                  <button onClick={() => removeFromCart(item.key)} className="text-slate-600 hover:text-red-400"><Trash2 size={14} /></button>
                </div>
              ))}

              {/* Divider + misc items */}
              {cart.some(i => i.isMisc) && (
                <>
                  <div className="flex items-center gap-2 py-1">
                    <div className="flex-1 border-t border-orange-800/40" />
                    <span className="text-[10px] text-orange-400 font-semibold uppercase tracking-wider flex items-center gap-1">
                      <Package size={10} /> Misc (cashier)
                    </span>
                    <div className="flex-1 border-t border-orange-800/40" />
                  </div>
                  {cart.filter(i => i.isMisc).map(item => (
                    <div key={item.key} className="flex items-center gap-2 bg-orange-950/20 border border-orange-900/30 rounded-lg p-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-200 truncate">{item.label}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold leading-none bg-orange-900 text-orange-300 border-orange-700">MISC</span>
                          <span className="text-xs text-slate-400">{fmtRs(item.unitPrice)} each</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => updateQty(item.key, -1)} className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-slate-300"><Minus size={12} /></button>
                        <span className="w-6 text-center text-sm font-medium text-white">{item.quantity}</span>
                        <button onClick={() => updateQty(item.key, +1)} className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-slate-300"><Plus size={12} /></button>
                      </div>
                      <div className="text-sm font-semibold text-orange-400 w-16 text-right">{fmtRs(item.unitPrice * item.quantity)}</div>
                      <button onClick={() => removeFromCart(item.key)} className="text-slate-600 hover:text-red-400"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Checkout panel */}
        {cart.length > 0 && (
          <div className="border-t border-slate-700 bg-slate-800 p-3 space-y-3 flex-shrink-0">

            {/* Totals breakdown */}
            <div className="space-y-0.5">
              {cart.some(i => !i.isMisc) && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Liquor</span>
                  <span className="text-slate-300">{fmtRs(liquorTotal)}</span>
                </div>
              )}
              {cart.some(i => i.isMisc) && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-orange-400">Misc ({activeStaff?.name ?? '—'})</span>
                  <span className="text-orange-300">{fmtRs(miscCartTotal)}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1 border-t border-slate-700">
                <span className="text-slate-300 font-medium">Total</span>
                <span className="text-2xl font-bold text-white">{fmtRs(cartTotal)}</span>
              </div>
            </div>

            {/* Payment mode */}
            <div className="grid grid-cols-4 gap-1">
              {(['CASH', 'CARD', 'UPI', 'SPLIT'] as PaymentMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setPaymentMode(mode)}
                  className={`py-2 rounded text-xs font-medium transition-colors flex flex-col items-center gap-1
                    ${paymentMode === mode ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                >
                  {mode === 'CASH'  && <Banknote size={14} />}
                  {mode === 'CARD'  && <CreditCard size={14} />}
                  {mode === 'UPI'   && <Smartphone size={14} />}
                  {mode === 'SPLIT' && <span className="text-base leading-none">⅔</span>}
                  {mode}
                </button>
              ))}
            </div>

            {/* Split inputs */}
            {paymentMode === 'SPLIT' && (
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Cash', val: cashAmount, set: setCashAmount },
                  { label: 'Card', val: cardAmount, set: setCardAmount },
                  { label: 'UPI',  val: upiAmount,  set: setUpiAmount  },
                ].map(({ label, val, set }) => (
                  <div key={label}>
                    <label className="text-xs text-slate-400 mb-1 block">{label}</label>
                    <input type="number" value={val} onChange={e => set(e.target.value)}
                      className="w-full bg-slate-700 text-white rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="0" />
                  </div>
                ))}
                {splitDiff > 0.01 && (
                  <div className="col-span-3 text-xs text-red-400">
                    Difference: {fmtRs(splitDiff)} — amounts must equal total
                  </div>
                )}
              </div>
            )}

            {/* Customer name */}
            <input
              type="text"
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
              placeholder="Customer name (optional)"
              className="w-full bg-slate-700 text-slate-200 rounded px-2 py-1.5 text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />

            {/* Confirm */}
            <button
              onClick={handleCheckout}
              disabled={!canSubmit || isSubmitting}
              className={`w-full py-3 rounded-lg font-bold text-base transition-all
                ${canSubmit && !isSubmitting
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white active:scale-[0.98]'
                  : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`}
            >
              {isSubmitting ? 'Recording…' : `Confirm Sale · ${fmtRs(cartTotal)}`}
            </button>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {showManage && (
        <ManageMiscModal
          items={miscItems}
          onClose={() => setShowManage(false)}
          onRefresh={() => { loadMiscItems(); setShowManage(false) }}
        />
      )}
      {showOneOff && (
        <OneOffModal
          onAdd={addOneOffToCart}
          onClose={() => setShowOneOff(false)}
        />
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className={`fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 rounded-lg shadow-xl text-sm font-medium
          ${toast.type === 'ok' ? 'bg-emerald-800 text-emerald-100' : 'bg-red-900 text-red-100'}`}>
          {toast.type === 'ok' ? <CheckCircle size={16} className="text-emerald-400" /> : <AlertCircle size={16} className="text-red-400" />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}
