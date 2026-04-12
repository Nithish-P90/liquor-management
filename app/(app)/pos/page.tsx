'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'

// ── Types ─────────────────────────────────────────────────────────────────────
type ProductSize = {
  id: number; sizeMl: number; bottlesPerCase: number; mrp: number
  sellingPrice: number; barcode: string | null; currentStock: number
  product: { id: number; name: string; category: string; itemCode: string }
}
type CartItem = {
  productSizeId: number; name: string; sizeMl: number
  sellingPrice: number; qty: number; stock: number
}
type Cashier = { id: number; name: string; active: boolean }
type PayMode = 'CASH' | 'CARD' | 'UPI' | 'SPLIT'
type RecentSale = {
  id: number; saleTime: string; productName: string
  sizeMl: number; totalAmount: number; paymentMode: string; quantityBottles: number
}
const CATS = ['ALL', 'BRANDY', 'WHISKY', 'RUM', 'VODKA', 'GIN', 'WINE', 'PREMIX', 'BEER', 'BEVERAGE']

function fmt(n: number) { return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 }) }

function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(2500, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(3000, ctx.currentTime + 0.05);

    gain.gain.setValueAtTime(0.04, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } catch (e) {
    console.error('Audio beep failed', e);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function POSPage() {
  const { data: session } = useSession()
  const user = session?.user as { id?: string; name?: string; role?: string } | undefined

  const [products, setProducts] = useState<ProductSize[]>([])
  const [cashiers, setCashiers] = useState<Cashier[]>([])
  const [loading, setLoading] = useState(true)
  const [recentSales, setRecentSales] = useState<RecentSale[]>([])

  const [category, setCategory] = useState('ALL')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [activeCashier, setActiveCashier] = useState<Cashier | null>(null)
  const [showCashierModal, setShowCashierModal] = useState(false)

  const [payMode, setPayMode] = useState<PayMode>('CASH')
  const [tendered, setTendered] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [splitCash, setSplitCash] = useState('')
  const [splitMethod, setSplitMethod] = useState<'UPI' | 'CARD'>('UPI')

  const [processing, setProcessing] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [showPayment, setShowPayment] = useState(false)

  const scanRef = useRef<HTMLInputElement>(null)
  const barcodeBuffer = useRef('')
  const barcodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load Data ──────────────────────────────────────────────────────────────
  const loadProducts = useCallback(async () => {
    try {
      const res = await fetch('/api/pos/products')
      if (res.ok) setProducts(await res.json())
    } finally { setLoading(false) }
  }, [])

  const loadRecent = useCallback(async () => {
    try {
      const res = await fetch('/api/pos/summary')
      if (res.ok) {
        const d = await res.json()
        setRecentSales(d.recentSales?.slice(0, 8) ?? [])
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    loadProducts()
    loadRecent()
    fetch('/api/staff').then(r => r.json()).then((list: Cashier[]) => {
      const active = list.filter(s => s.active)
      setCashiers(active)
      const me = active.find(s => s.id === parseInt(user?.id ?? '0'))
      setActiveCashier(me ?? active[0] ?? null)
    })
  }, [loadProducts, loadRecent, user?.id])

  // ── USB Barcode Scanner ────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement

      // Hotkeys (Global)
      if (e.key === 'F2') {
        e.preventDefault()
        setShowPayment(true); setPayMode('CASH')
        return
      }
      if (e.key === 'F4') {
        e.preventDefault()
        setShowPayment(true); setPayMode('CARD')
        return
      }

      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') {
        if (e.key === 'Enter') {
            // Trigger complete sale if hitting enter while entering cash amount
            if (showPayment) { completeSale(); return }
        }
        return
      }

      if (e.key === 'Enter') {
        if (showPayment) {
          completeSale()
          return
        } else if (cart.length > 0) {
           setShowPayment(true); setPayMode('CASH')
           return
        }

        const code = barcodeBuffer.current.trim()
        if (code.length >= 4) handleScan(code)
        barcodeBuffer.current = ''
        if (barcodeTimer.current) clearTimeout(barcodeTimer.current)
        return
      }
      
      if (e.key.length === 1) {
        barcodeBuffer.current += e.key
        if (barcodeTimer.current) clearTimeout(barcodeTimer.current)
        barcodeTimer.current = setTimeout(() => { barcodeBuffer.current = '' }, 120)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scan Handler ───────────────────────────────────────────────────────────
  function handleScan(code: string) {
    const found = products.find(p => p.barcode === code || p.product.itemCode === code)
    if (!found) { flash(`No product found: ${code}`, 'err'); return }
    if (found.currentStock <= 0) { flash(`${found.product.name} — OUT OF STOCK`, 'err'); return }
    playBeep()
    addToCart(found)
    flash(`${found.product.name} ${found.sizeMl}ml added`, 'ok')
  }

  // ── Cart ────────────────────────────────────────────────────────────────────
  function addToCart(ps: ProductSize) {
    if (ps.currentStock <= 0) { flash('Out of stock', 'err'); return }
    setCart(prev => {
      const ex = prev.find(c => c.productSizeId === ps.id)
      if (ex) {
        if (ex.qty >= ps.currentStock) { flash(`Only ${ps.currentStock} left`, 'err'); return prev }
        return prev.map(c => c.productSizeId === ps.id ? { ...c, qty: c.qty + 1 } : c)
      }
      return [...prev, {
        productSizeId: ps.id, name: ps.product.name, sizeMl: ps.sizeMl,
        sellingPrice: Number(ps.sellingPrice), qty: 1, stock: ps.currentStock,
      }]
    })
  }

  function setQty(id: number, d: number) {
    setCart(prev => prev.flatMap(c => {
      if (c.productSizeId !== id) return [c]
      const nq = c.qty + d
      if (nq <= 0) return []
      if (nq > c.stock) { flash(`Only ${c.stock} available`, 'err'); return [c] }
      return [{ ...c, qty: nq }]
    }))
  }

  const cartTotal = cart.reduce((s, c) => s + c.sellingPrice * c.qty, 0)
  const cartItems = cart.reduce((s, c) => s + c.qty, 0)
  const splitCashNum = parseFloat(splitCash) || 0
  const splitRemainder = Math.max(0, cartTotal - splitCashNum)
  const tenderedNum = parseFloat(tendered) || 0
  const change = payMode === 'CASH' && tenderedNum > cartTotal ? tenderedNum - cartTotal : 0

  // ── Checkout ───────────────────────────────────────────────────────────────
  async function completeSale() {
    if (!cart.length || !activeCashier) return
    // Credit logic removed
    if (payMode === 'SPLIT' && splitCashNum <= 0) { flash('Enter cash amount', 'err'); return }

    setProcessing(true)
    try {
      
      // ── HDFC BonusHub Terminal Integration ──
      const needsTerminal = payMode === 'CARD' || payMode === 'UPI' || (payMode === 'SPLIT' && (splitMethod === 'CARD' || splitMethod === 'UPI'))
      if (needsTerminal) {
        const terminalAmt = payMode === 'SPLIT' ? splitRemainder : cartTotal
        const tr = await fetch('/api/card-terminal/push', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: terminalAmt, type: payMode === 'SPLIT' ? splitMethod : payMode })
        })
        if (!tr.ok) {
           flash('EDC Terminal transaction failed or rejected. Please manually retry.', 'err')
           setProcessing(false)
           return
        }
      }

      for (const item of cart) {
        const prop = item.sellingPrice * item.qty / cartTotal
        const body: Record<string, unknown> = {
          productSizeId: item.productSizeId, quantityBottles: item.qty,
          paymentMode: payMode, scanMethod: 'MANUAL', staffId: activeCashier.id,
          customerName: null,
        }
        if (payMode === 'SPLIT') {
          body.cashAmount = +(splitCashNum * prop).toFixed(2)
          body[splitMethod === 'UPI' ? 'upiAmount' : 'cardAmount'] = +(splitRemainder * prop).toFixed(2)
        }
        const res = await fetch('/api/sales', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Sale failed') }
      }
      const total = cartTotal
      resetSale()
      flash(`Bill complete — ${fmt(total)}`, 'ok')
      loadProducts()
      loadRecent()
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'Failed', 'err')
    } finally { setProcessing(false) }
  }

  function resetSale() {
    setCart([]); setPayMode('CASH'); setTendered(''); setSplitCash('')
    setCustomerName(''); setShowPayment(false)
  }

  function flash(msg: string, type: 'ok' | 'err') {
    setToast({ msg, type }); setTimeout(() => setToast(null), 2500)
  }

  // ── Filtered Products ──────────────────────────────────────────────────────
  const filtered = products.filter(p => {
    if (category !== 'ALL' && p.product.category !== category) return false
    if (!search) return true
    const q = search.toLowerCase()
    return p.product.name.toLowerCase().includes(q) || p.product.itemCode.toLowerCase().includes(q)
  })

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden bg-[#0f1117]" style={{ userSelect: 'none' }}>

      {/* ── Toast ────────────────────────────── */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-lg text-sm font-semibold shadow-2xl pointer-events-none transition-all ${
          toast.type === 'ok' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
        }`}>{toast.msg}</div>
      )}

      {/* ── Cashier Modal ────────────────────── */}
      {showCashierModal && (
        <div className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center" onClick={() => setShowCashierModal(false)}>
          <div className="bg-[#1a1d27] rounded-2xl p-6 w-80 border border-[#2a2d3a]" onClick={e => e.stopPropagation()}>
            <h3 className="text-white font-bold text-sm mb-4">Select Cashier</h3>
            <div className="space-y-2">
              {cashiers.map(c => (
                <button key={c.id} onClick={() => { setActiveCashier(c); setShowCashierModal(false) }}
                  className={`w-full px-4 py-3 rounded-xl text-sm font-medium text-left transition ${
                    activeCashier?.id === c.id ? 'bg-blue-600 text-white' : 'bg-[#252836] text-gray-300 hover:bg-[#2a2d3a]'
                  }`}>{c.name}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          LEFT PANEL — Products
         ═══════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* ── Top Bar ──────────────────────── */}
        <div className="h-14 bg-[#1a1d27] border-b border-[#252836] flex items-center px-4 gap-3 flex-shrink-0">
          <div className="text-white font-bold text-sm tracking-wide">MV <span className="text-blue-400">POS</span></div>

          {/* Barcode scan input */}
          <div className="flex-1 max-w-md relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input ref={scanRef} value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && search.trim()) {
                  // Try barcode scan first
                  const code = search.trim()
                  const found = products.find(p => p.barcode === code || p.product.itemCode === code)
                  if (found) { addToCart(found); setSearch(''); flash(`${found.product.name} added`, 'ok') }
                  else if (filtered.length === 1) { addToCart(filtered[0]); setSearch('') }
                }
              }}
              placeholder="Scan barcode or search..."
              className="w-full pl-9 pr-3 py-2 bg-[#252836] text-white placeholder-gray-500 rounded-lg text-sm outline-none focus:ring-1 focus:ring-blue-500 transition" />
          </div>

          <div className="text-gray-500 text-xs hidden lg:block">
            {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </div>

          {/* Cashier */}
          <button onClick={() => setShowCashierModal(true)}
            className="flex items-center gap-2 bg-[#252836] hover:bg-[#2a2d3a] text-white px-3 py-2 rounded-lg text-xs font-medium transition flex-shrink-0">
            <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-[10px] font-bold">
              {activeCashier?.name?.[0] ?? '?'}
            </div>
            <span className="hidden md:inline">{activeCashier?.name ?? 'Select'}</span>
          </button>
        </div>

        {/* ── Category Tabs ────────────────── */}
        <div className="bg-[#1a1d27] flex overflow-x-auto px-2 flex-shrink-0" style={{ scrollbarWidth: 'none' }}>
          {CATS.map(cat => (
            <button key={cat} onClick={() => setCategory(cat)}
              className={`px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition border-b-2 -mb-px ${
                category === cat
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}>{cat}</button>
          ))}
        </div>

        {/* ── Product Grid ─────────────────── */}
        <div className="flex-1 overflow-y-auto p-3" style={{ scrollbarWidth: 'thin', scrollbarColor: '#252836 transparent' }}>
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-600 text-sm">
              {products.length === 0 ? 'No products loaded' : 'No matches found'}
            </div>
          ) : (
            <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
              {filtered.map(ps => {
                const inCart = cart.find(c => c.productSizeId === ps.id)
                const oos = ps.currentStock === 0
                return (
                  <button key={ps.id} onClick={() => addToCart(ps)} disabled={oos}
                    className={`relative text-left rounded-xl p-3 transition-all ${
                      oos ? 'bg-[#1a1d27] opacity-30 cursor-not-allowed'
                        : inCart ? 'bg-[#252836] ring-2 ring-blue-500'
                        : 'bg-[#1a1d27] hover:bg-[#252836] active:scale-[0.97] cursor-pointer'
                    }`}>
                    {/* Cart badge */}
                    {inCart && (
                      <span className="absolute -top-1 -right-1 min-w-[20px] h-5 bg-blue-500 text-white rounded-full text-[10px] flex items-center justify-center font-bold px-1 shadow-lg">
                        {inCart.qty}
                      </span>
                    )}
                    {/* Category dot */}
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        ps.product.category === 'BRANDY' ? 'bg-amber-500' :
                        ps.product.category === 'WHISKY' ? 'bg-yellow-500' :
                        ps.product.category === 'RUM' ? 'bg-orange-500' :
                        ps.product.category === 'VODKA' ? 'bg-sky-500' :
                        ps.product.category === 'BEER' ? 'bg-yellow-400' :
                        ps.product.category === 'WINE' ? 'bg-rose-500' :
                        'bg-gray-500'
                      }`} />
                      <span className="text-[9px] text-gray-500 font-medium uppercase">{ps.product.category}</span>
                    </div>
                    {/* Name */}
                    <div className="text-[12px] font-semibold text-gray-200 leading-tight mb-1 line-clamp-2 min-h-[2rem]">
                      {ps.product.name}
                    </div>
                    {/* Size */}
                    <div className="text-[10px] text-gray-500 mb-1.5">{ps.sizeMl}ml</div>
                    {/* Price + Stock */}
                    <div className="flex items-end justify-between">
                      <span className="text-sm font-bold text-white">{fmt(Number(ps.sellingPrice))}</span>
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                        oos ? 'bg-red-900/50 text-red-400' :
                        ps.currentStock <= 6 ? 'bg-amber-900/50 text-amber-400' :
                        'bg-emerald-900/50 text-emerald-400'
                      }`}>
                        {oos ? 'NIL' : ps.currentStock}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════
          RIGHT PANEL — Bill
         ═══════════════════════════════════════════════════ */}
      <div className="w-[340px] bg-[#1a1d27] border-l border-[#252836] flex flex-col flex-shrink-0">

        {/* Bill Header */}
        <div className="h-14 border-b border-[#252836] flex items-center justify-between px-4 flex-shrink-0">
          <div>
            <span className="text-white font-bold text-sm">Current Bill</span>
            {cartItems > 0 && <span className="ml-2 text-xs text-gray-500">({cartItems} item{cartItems > 1 ? 's' : ''})</span>}
          </div>
          {cart.length > 0 && (
            <button onClick={() => { setCart([]); setShowPayment(false) }}
              className="text-[10px] text-red-400 hover:text-red-300 font-semibold uppercase tracking-wide">
              Clear
            </button>
          )}
        </div>

        {/* Bill Items */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#252836 transparent' }}>
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-3 px-6">
              <svg className="w-12 h-12 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-500">No items in bill</p>
                <p className="text-[11px] text-gray-600 mt-1">Scan barcode or tap products</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[#252836]">
              {cart.map((item, idx) => (
                <div key={item.productSizeId} className="px-4 py-3 group">
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] text-gray-600 font-mono mt-0.5 w-4 flex-shrink-0">{idx + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-200 leading-tight">{item.name}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">{item.sizeMl}ml × {fmt(item.sellingPrice)}</p>
                    </div>
                    <button onClick={() => setCart(prev => prev.filter(c => c.productSizeId !== item.productSizeId))}
                      className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition flex-shrink-0">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-2 ml-6">
                    <div className="flex items-center bg-[#252836] rounded-lg overflow-hidden">
                      <button onClick={() => setQty(item.productSizeId, -1)}
                        className="w-7 h-7 text-gray-400 hover:text-white hover:bg-[#2a2d3a] text-sm font-medium flex items-center justify-center transition">−</button>
                      <span className="w-8 text-center text-xs font-bold text-white">{item.qty}</span>
                      <button onClick={() => setQty(item.productSizeId, +1)}
                        className="w-7 h-7 text-gray-400 hover:text-white hover:bg-[#2a2d3a] text-sm font-medium flex items-center justify-center transition">+</button>
                    </div>
                    <span className="text-sm font-bold text-white">{fmt(item.sellingPrice * item.qty)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Last Sales Ticker ─────────────── */}
        {cart.length === 0 && recentSales.length > 0 && (
          <div className="border-t border-[#252836] px-4 py-3">
            <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-2">Recent Sales</p>
            <div className="space-y-1.5 max-h-32 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              {recentSales.slice(0, 5).map((s, i) => (
                <div key={s.id || i} className="flex items-center justify-between text-[11px]">
                  <span className="text-gray-400 truncate max-w-[160px]">{s.productName} {s.sizeMl}ml</span>
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                      s.paymentMode === 'CASH' ? 'bg-emerald-900/60 text-emerald-400' :
                      s.paymentMode === 'CREDIT' ? 'bg-amber-900/60 text-amber-400' :
                      'bg-violet-900/60 text-violet-400'
                    }`}>{s.paymentMode}</span>
                    <span className="text-white font-semibold">{fmt(s.totalAmount)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Payment Footer ──────────────── */}
        {cart.length > 0 && (
          <div className="border-t border-[#252836] bg-[#14161e] flex-shrink-0">

            {/* Totals */}
            <div className="px-4 pt-3 pb-2">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Subtotal ({cartItems} btls)</span>
                <span>{fmt(cartTotal)}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-sm font-bold text-white">TOTAL</span>
                <span className="text-2xl font-black text-white tracking-tight">{fmt(cartTotal)}</span>
              </div>
            </div>

            {/* Payment mode selection */}
            {!showPayment ? (
              <div className="px-4 pb-4">
                <button onClick={() => setShowPayment(true)}
                  className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-xl transition active:scale-[0.98] shadow-lg shadow-blue-600/20">
                  Proceed to Pay — {fmt(cartTotal)}
                </button>
              </div>
            ) : (
              <div className="px-4 pb-4 space-y-2.5">
                {/* Payment mode buttons */}
                <div className="grid grid-cols-4 gap-1">
                  {(['CASH', 'CARD', 'UPI', 'SPLIT'] as const).map(m => (
                    <button key={m} onClick={() => setPayMode(m)}
                      className={`py-2 text-[10px] font-bold rounded-lg transition ${
                        payMode === m
                          ? m === 'CASH' ? 'bg-emerald-600 text-white' :
                            m === 'SPLIT' ? 'bg-violet-600 text-white' :
                            'bg-blue-600 text-white'
                          : 'bg-[#252836] text-gray-400 hover:text-white hover:bg-[#2a2d3a]'
                      }`}>{m}</button>
                  ))}
                </div>

                {/* Cash — tendered */}
                {payMode === 'CASH' && (
                  <div className="bg-[#252836] rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500 w-14 font-medium">Received</span>
                      <input type="number" value={tendered} onChange={e => setTendered(e.target.value)}
                        placeholder={cartTotal.toString()} autoFocus
                        className="flex-1 text-sm px-3 py-1.5 bg-[#1a1d27] text-white rounded-lg text-right font-semibold outline-none focus:ring-1 focus:ring-emerald-500" />
                    </div>
                    {tenderedNum > 0 && (
                      <div className="flex justify-between px-1">
                        <span className="text-[10px] text-gray-500">Change</span>
                        <span className={`text-sm font-bold ${change > 0 ? 'text-emerald-400' : 'text-white'}`}>{fmt(change)}</span>
                      </div>
                    )}
                  </div>
                )}


                {/* Split */}
                {payMode === 'SPLIT' && (
                  <div className="bg-[#252836] rounded-xl p-4 space-y-3 shadow-inner">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 font-bold uppercase tracking-wider w-16">Cash</span>
                      <input type="number" value={splitCash} onChange={e => setSplitCash(e.target.value)}
                        placeholder="0" autoFocus
                        className="flex-1 text-lg px-4 py-3 bg-[#1a1d27] text-white rounded-xl text-right font-bold outline-none focus:ring-2 focus:ring-violet-500 transition shadow-sm" />
                    </div>
                    <div className="flex items-center gap-3">
                      <select value={splitMethod} onChange={e => setSplitMethod(e.target.value as any)}
                        className="w-24 bg-[#1a1d27] text-violet-400 text-sm font-black rounded-xl outline-none focus:ring-2 focus:ring-violet-500 border border-[#2a2d3a] py-3 px-2 text-center cursor-pointer shadow-sm transition">
                        <option value="UPI">UPI</option>
                        <option value="CARD">CARD</option>
                      </select>
                      <div className="flex-1 text-lg px-4 py-3 bg-[#1a1d27] text-violet-300 rounded-xl text-right font-black border border-[#2a2d3a] shadow-sm">
                        {fmt(splitRemainder)}
                      </div>
                    </div>
                  </div>
                )}

                {/* Collect button */}
                <button onClick={completeSale} disabled={processing}
                  className={`w-full py-4 text-lg font-black rounded-xl transition shadow-lg flex items-center justify-center gap-2 tracking-wide ${
                    payMode === 'CASH' ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20 focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-[#1a1d27]' :
                    payMode === 'SPLIT' ? 'bg-violet-600 hover:bg-violet-500 text-white shadow-violet-500/20 focus:ring-2 focus:ring-violet-400 focus:ring-offset-2 focus:ring-offset-[#1a1d27]' :
                    'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20 focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-[#1a1d27]'
                  }`}>
                  {processing ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-5 h-5 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                      Processing...
                    </div>
                  ) : (
                    `Complete Sale [Enter] — ${payMode}`
                  )}
                </button>

                {/* Back */}
                <button onClick={() => setShowPayment(false)}
                  className="w-full py-2 text-xs text-gray-500 hover:text-gray-300 font-bold transition uppercase tracking-widest mt-1">
                  ← Back to cart
                </button>
              </div>
            )}
          </div>
        )}

        {/* Empty footer */}
        {cart.length === 0 && recentSales.length === 0 && (
          <div className="border-t border-[#252836] px-4 py-3 text-center">
            <p className="text-[10px] text-gray-600">{activeCashier ? `${activeCashier.name} on duty` : 'No cashier selected'}</p>
          </div>
        )}
      </div>
    </div>
  )
}
