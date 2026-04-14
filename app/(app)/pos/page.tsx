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
const CATS = ['ALL', 'BRANDY', 'WHISKY', 'RUM', 'VODKA', 'GIN', 'WINE', 'PREMIX', 'BEER', 'BEVERAGE', 'MISCELLANEOUS']

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
    if (payMode === 'CASH' && tenderedNum < cartTotal) { flash('Enter amount received', 'err'); return }
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
          customerName: customerName || null,
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

  async function voidSale(saleId: number, productName: string) {
    if (!confirm(`Void sale of "${productName}"? Stock will be returned.`)) return
    const res = await fetch('/api/sales/void', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saleId }),
    })
    if (res.ok) {
      flash('Sale voided — stock returned', 'ok')
      loadRecent()
      loadProducts()
    } else {
      const e = await res.json()
      flash(e.error || 'Void failed', 'err')
    }
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
    <div className="flex h-full overflow-hidden bg-slate-50" style={{ userSelect: 'none' }}>

      {/* ── Toast ────────────────────────────── */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-lg text-sm font-semibold shadow-2xl pointer-events-none transition-all ${
          toast.type === 'ok' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
        }`}>{toast.msg}</div>
      )}

      {/* ── Cashier Modal ────────────────────── */}
      {showCashierModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 flex items-center justify-center font-sans" onClick={() => setShowCashierModal(false)}>
          <div className="bg-white rounded-3xl p-8 w-96 shadow-2xl border border-slate-200 animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
            <h3 className="text-slate-900 font-black text-xl mb-6 tracking-tight">Select Cashier</h3>
            <div className="space-y-2">
              {cashiers.map(c => (
                <button key={c.id} onClick={() => { setActiveCashier(c); setShowCashierModal(false) }}
                  className={`w-full px-5 py-4 rounded-2xl text-sm font-bold text-left transition-all duration-200 ${
                    activeCashier?.id === c.id 
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' 
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
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
        <div className="h-16 bg-white border-b border-slate-200 flex items-center px-6 gap-4 flex-shrink-0">
          <div className="text-slate-900 font-black text-lg tracking-tighter italic">MV <span className="text-blue-600 not-italic">POS</span></div>

          {/* Barcode scan input */}
          <div className="flex-1 max-w-md relative">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input ref={scanRef} value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && search.trim()) {
                  const code = search.trim()
                  const found = products.find(p => p.barcode === code || p.product.itemCode === code)
                  if (found) { addToCart(found); setSearch(''); flash(`${found.product.name} added`, 'ok') }
                  else if (filtered.length === 1) { addToCart(filtered[0]); setSearch('') }
                }
              }}
              placeholder="Scan barcode or type name..."
              className="w-full pl-11 pr-4 py-2.5 bg-slate-50 text-slate-900 placeholder-slate-400 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20 border border-transparent focus:border-blue-500 transition-all shadow-inner" />
          </div>

          <div className="text-gray-500 text-xs hidden lg:block">
            {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </div>

          {/* Cashier */}
          <button onClick={() => setShowCashierModal(true)}
            className="flex items-center gap-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 px-4 py-2 rounded-xl text-xs font-bold transition-all border border-slate-100 flex-shrink-0">
            <div className="w-6 h-6 bg-blue-600 rounded-lg flex items-center justify-center text-[10px] font-black text-white shadow-sm">
              {activeCashier?.name?.[0] ?? '?'}
            </div>
            <span className="hidden md:inline">{activeCashier?.name ?? 'Select'}</span>
          </button>
        </div>

        {/* ── Category Tabs ────────────────── */}
        <div className="bg-white flex overflow-x-auto px-4 flex-shrink-0 pt-1" style={{ scrollbarWidth: 'none' }}>
          {CATS.map(cat => (
            <button key={cat} onClick={() => setCategory(cat)}
              className={`px-5 py-3 text-[11px] font-black whitespace-nowrap transition-all border-b-2 -mb-px tracking-wider uppercase ${
                category === cat
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'
              }`}>{cat}</button>
          ))}
        </div>

        {/* ── Product Grid ─────────────────── */}
        <div className="flex-1 overflow-y-auto p-4" style={{ scrollbarWidth: 'none' }}>
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
                    className={`relative text-left rounded-2xl p-4 transition-all duration-200 group ${
                      oos ? 'bg-white/50 opacity-40 cursor-not-allowed border border-slate-100'
                        : inCart ? 'bg-white ring-2 ring-blue-600 shadow-xl shadow-blue-100 scale-[0.98]'
                        : 'bg-white hover:bg-white hover:shadow-xl hover:shadow-slate-200/50 hover:-translate-y-1 active:scale-[0.96] cursor-pointer border border-slate-200/60'
                    }`}>
                    {/* Cart badge */}
                    {inCart && (
                      <span className="absolute -top-1 -right-1 min-w-[20px] h-5 bg-blue-500 text-white rounded-full text-[10px] flex items-center justify-center font-bold px-1 shadow-lg">
                        {inCart.qty}
                      </span>
                    )}
                    {/* Category dot */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`w-2 h-2 rounded-full shadow-sm ${
                        ps.product.category === 'BRANDY' ? 'bg-amber-500' :
                        ps.product.category === 'WHISKY' ? 'bg-yellow-500' :
                        ps.product.category === 'RUM' ? 'bg-orange-500' :
                        ps.product.category === 'VODKA' ? 'bg-sky-500' :
                        ps.product.category === 'BEER' ? 'bg-yellow-400' :
                        ps.product.category === 'WINE' ? 'bg-rose-500' :
                        'bg-slate-400'
                      }`} />
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{ps.product.category}</span>
                    </div>
                    {/* Name */}
                    <div className="text-[13px] font-extrabold text-slate-800 leading-tight mb-1.5 line-clamp-2 min-h-[2rem]">
                      {ps.product.name}
                    </div>
                    {/* Size */}
                    <div className="text-[11px] text-slate-400 font-medium mb-2.5">{ps.sizeMl}ml</div>
                    {/* Price + Stock */}
                    <div className="flex items-center justify-between">
                      <span className="text-base font-black text-slate-900 tracking-tight">{fmt(Number(ps.sellingPrice))}</span>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg uppercase tracking-tighter ${
                        oos ? 'bg-red-50 text-red-500' :
                        ps.currentStock <= 6 ? 'bg-amber-50 text-amber-600' :
                        'bg-emerald-50 text-emerald-600'
                      }`}>
                        {oos ? 'NIL' : `${ps.currentStock} in`}
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
      <div className="w-[380px] bg-white border-l border-slate-200 flex flex-col flex-shrink-0 shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.05)]">

        {/* Bill Header */}
        <div className="h-16 border-b border-slate-100 flex items-center justify-between px-6 flex-shrink-0">
          <div>
            <span className="text-slate-900 font-black text-lg tracking-tight">Current Bill</span>
            {cartItems > 0 && <span className="ml-2 text-xs text-slate-400 font-bold">({cartItems})</span>}
          </div>
          {cart.length > 0 && (
            <button onClick={() => { setCart([]); setShowPayment(false) }}
              className="text-[11px] text-red-500 hover:text-red-600 font-black uppercase tracking-widest px-3 py-1.5 bg-red-50 rounded-lg transition-colors">
              Clear All
            </button>
          )}
        </div>

        {/* Bill Items */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-300 gap-4 px-8">
              <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center">
                <svg className="w-10 h-10 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-base font-black text-slate-400 tracking-tight">No Items Added</p>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">Scan a bottle or select from the product grid to start billing.</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {cart.map((item, idx) => (
                <div key={item.productSizeId} className="px-6 py-4 hover:bg-slate-50/50 transition-colors group">
                  <div className="flex items-start gap-3">
                    <span className="text-[11px] text-slate-300 font-bold mt-1 w-5 flex-shrink-0">{String(idx + 1).padStart(2, '0')}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-slate-800 leading-snug">{item.name}</p>
                      <p className="text-[11px] text-slate-400 font-bold mt-1">{item.sizeMl}ml · {fmt(item.sellingPrice)}</p>
                    </div>
                    <button onClick={() => setCart(prev => prev.filter(c => c.productSizeId !== item.productSizeId))}
                      className="opacity-0 group-hover:opacity-100 p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all flex-shrink-0">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-4 pl-8">
                    <div className="flex items-center bg-slate-100 rounded-xl overflow-hidden p-0.5 border border-slate-200">
                      <button onClick={() => setQty(item.productSizeId, -1)}
                        className="w-8 h-8 text-slate-500 hover:text-slate-900 hover:bg-white rounded-lg font-black flex items-center justify-center transition">−</button>
                      <span className="w-10 text-center text-xs font-black text-slate-900">{item.qty}</span>
                      <button onClick={() => setQty(item.productSizeId, +1)}
                        className="w-8 h-8 text-slate-500 hover:text-slate-900 hover:bg-white rounded-lg font-black flex items-center justify-center transition">+</button>
                    </div>
                    <span className="text-base font-black text-slate-900">{fmt(item.sellingPrice * item.qty)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Last Sales Ticker ─────────────── */}
        {cart.length === 0 && recentSales.length > 0 && (
          <div className="border-t border-slate-100 px-6 py-5 bg-slate-50/50">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Recent Transactions</p>
            <div className="space-y-3 max-h-48 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              {recentSales.slice(0, 5).map((s, i) => (
                <div key={s.id || i} className="flex items-center justify-between text-[12px] gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-slate-800 font-bold truncate pr-1">{s.productName}</p>
                    <p className="text-[10px] text-slate-400 font-medium">{s.sizeMl}ml · {s.paymentMode}</p>
                  </div>
                  <span className="text-slate-900 font-black whitespace-nowrap">{fmt(s.totalAmount)}</span>
                  <button
                    onClick={() => voidSale(s.id, s.productName)}
                    className="text-[10px] text-red-400 hover:text-red-600 font-bold uppercase tracking-wide whitespace-nowrap px-1.5 py-0.5 rounded border border-red-200 hover:border-red-400 hover:bg-red-50 transition-colors"
                  >
                    Void
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Payment Footer ──────────────── */}
        {cart.length > 0 && (
          <div className="border-t border-slate-200 bg-white/50 backdrop-blur-md flex-shrink-0">

            {/* Totals */}
            <div className="px-6 pt-5 pb-4">
              <div className="flex justify-between text-xs text-slate-400 font-bold uppercase tracking-wider mb-2">
                <span>Total bottles ({cartItems})</span>
                <span>{fmt(cartTotal)}</span>
              </div>
              <div className="flex justify-between items-end">
                <span className="text-sm font-black text-slate-900 uppercase tracking-tighter mb-1">Total Payable</span>
                <span className="text-4xl font-black text-slate-900 tracking-tighter leading-none">{fmt(cartTotal)}</span>
              </div>
            </div>

            {/* Payment mode selection */}
            {!showPayment ? (
              <div className="px-6 pb-6">
                <button onClick={() => setShowPayment(true)}
                  className="w-full py-5 bg-blue-600 hover:bg-blue-700 text-white font-black text-base rounded-2xl transition-all active:scale-[0.98] shadow-2xl shadow-blue-200 flex items-center justify-center gap-3">
                  Proceed to Payment
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </button>
              </div>
            ) : (
              <div className="px-6 pb-6 space-y-4">
                {/* Payment mode buttons */}
                <div className="grid grid-cols-4 gap-2">
                  {(['CASH', 'CARD', 'UPI', 'SPLIT'] as const).map(m => (
                    <button key={m} onClick={() => setPayMode(m)}
                      className={`py-3 text-[11px] font-black rounded-xl transition-all ${
                        payMode === m
                          ? m === 'CASH' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-100' :
                            m === 'SPLIT' ? 'bg-violet-600 text-white shadow-lg shadow-violet-100' :
                            'bg-blue-600 text-white shadow-lg shadow-blue-100'
                          : 'bg-slate-100 text-slate-400 hover:text-slate-900 hover:bg-slate-200'
                      }`}>{m}</button>
                  ))}
                </div>

                {/* Cash — tendered */}
                {payMode === 'CASH' && (
                  <div className="bg-slate-50 rounded-2xl p-4 space-y-3 border border-slate-200">
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-slate-400 font-black uppercase tracking-widest w-20">Received</span>
                      <input type="number" value={tendered} onChange={e => setTendered(e.target.value)}
                        placeholder={cartTotal.toString()} autoFocus
                        className="flex-1 text-lg px-4 py-2.5 bg-white text-slate-900 border border-slate-200 rounded-xl text-right font-black outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm transition-all" />
                    </div>
                    {tenderedNum > 0 && (
                      <div className="flex justify-between items-center px-1">
                        <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Change Due</span>
                        <span className={`text-xl font-black ${change > 0 ? 'text-emerald-600' : 'text-slate-900'}`}>{fmt(change)}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Split */}
                {payMode === 'SPLIT' && (
                  <div className="bg-slate-50 rounded-2xl p-4 space-y-3 border border-slate-200">
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-slate-400 font-black uppercase tracking-widest w-20">Cash</span>
                      <input type="number" value={splitCash} onChange={e => setSplitCash(e.target.value)}
                        placeholder="0" autoFocus
                        className="flex-1 text-lg px-4 py-2.5 bg-white text-slate-900 border border-slate-200 rounded-xl text-right font-black outline-none focus:ring-2 focus:ring-violet-500 shadow-sm transition-all" />
                    </div>
                    <div className="flex items-center gap-3">
                      <select value={splitMethod} onChange={e => setSplitMethod(e.target.value as any)}
                        className="w-24 bg-white text-violet-600 text-[11px] font-black rounded-xl outline-none focus:ring-2 focus:ring-violet-500 border border-slate-200 py-3 px-2 text-center cursor-pointer shadow-sm transition-all uppercase tracking-widest">
                        <option value="UPI">UPI</option>
                        <option value="CARD">CARD</option>
                      </select>
                      <div className="flex-1 text-lg px-4 py-2.5 bg-violet-50 text-violet-700 rounded-xl text-right font-black border border-violet-100 shadow-sm">
                        {fmt(splitRemainder)}
                      </div>
                    </div>
                  </div>
                )}

                {/* Collect button */}
                <button onClick={completeSale} disabled={processing}
                  className={`w-full py-5 text-lg font-black rounded-2xl transition-all shadow-xl flex items-center justify-center gap-3 tracking-tight ${
                    payMode === 'CASH' ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200' :
                    payMode === 'SPLIT' ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-violet-200' :
                    'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200'
                  }`}>
                  {processing ? (
                    <div className="flex items-center justify-center gap-3">
                      <div className="w-6 h-6 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                      Finalizing...
                    </div>
                  ) : (
                    `Complete Transaction`
                  )}
                </button>

                {/* Back */}
                <button onClick={() => setShowPayment(false)}
                  className="w-full py-2 text-xs text-slate-400 hover:text-slate-600 font-black transition-all uppercase tracking-[0.2em] mt-2">
                  ← Back to Bill
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
