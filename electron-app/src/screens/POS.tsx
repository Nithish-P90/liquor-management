import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, Barcode, Plus, Minus, Trash2, CreditCard, Banknote, Smartphone, ShoppingBag, CheckCircle, AlertCircle, X } from 'lucide-react'
import type { Product, Sale, DailyTotals } from '../types'

type CartItem = {
  product: Product
  quantity: number
}

type PaymentMode = 'CASH' | 'CARD' | 'UPI' | 'SPLIT'

const CATEGORIES = ['ALL', 'BEER', 'WHISKY', 'BRANDY', 'RUM', 'VODKA', 'GIN', 'WINE', 'PREMIX', 'BEVERAGE']

const fmtRs = (n: number) => `₹${n.toFixed(2)}`

export default function POS() {
  const [products, setProducts] = useState<Product[]>([])
  const [staff, setStaff]       = useState<{ id: number; name: string; role: string }[]>([])
  const [search, setSearch]     = useState('')
  const [category, setCategory] = useState('ALL')
  const [cart, setCart]         = useState<CartItem[]>([])
  const [todaySales, setTodaySales]   = useState<Sale[]>([])
  const [totals, setTotals]     = useState<DailyTotals | null>(null)
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('CASH')
  const [cashAmount, setCashAmount]   = useState('')
  const [cardAmount, setCardAmount]   = useState('')
  const [upiAmount, setUpiAmount]     = useState('')
  const [customerName, setCustomerName] = useState('')
  const [activeStaffId, setActiveStaffId] = useState<number | null>(null)
  const [isSubmitting, setIsSubmitting]   = useState(false)
  const [toast, setToast]       = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const [barcodeBuffer, setBarcodeBuffer] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const barcodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load data
  const loadData = useCallback(async () => {
    const [prods, stf, sales, tot] = await Promise.all([
      window.posAPI.getProducts(),
      window.posAPI.getStaff(),
      window.posAPI.getTodaySales(),
      window.posAPI.getTodayTotals(),
    ])
    setProducts(prods)
    setStaff(stf)
    setTodaySales(sales)
    setTotals(tot)
    if (!activeStaffId && stf.length > 0) setActiveStaffId(stf[0].id)
  }, [activeStaffId])

  useEffect(() => {
    loadData()
    // Refresh totals after sync events
    const unsub = window.posAPI.onSyncEvent((event) => {
      if (event === 'push_complete' || event === 'pull_complete') loadData()
    })
    return () => unsub()
  }, [loadData])

  // Global barcode scanner (USB HID scanners send keystrokes)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Ignore if typing in an input that's not the barcode target
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' && target !== searchRef.current) return

      if (e.key === 'Enter') {
        if (barcodeBuffer.length >= 4) {
          handleBarcodeInput(barcodeBuffer)
        }
        setBarcodeBuffer('')
        if (barcodeTimerRef.current) clearTimeout(barcodeTimerRef.current)
      } else if (e.key.length === 1) {
        setBarcodeBuffer(prev => prev + e.key)
        if (barcodeTimerRef.current) clearTimeout(barcodeTimerRef.current)
        barcodeTimerRef.current = setTimeout(() => setBarcodeBuffer(''), 500)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
      if (barcodeTimerRef.current) clearTimeout(barcodeTimerRef.current)
    }
  }, [barcodeBuffer, products])

  async function handleBarcodeInput(barcode: string) {
    const product = await window.posAPI.getProductByBarcode(barcode)
    if (product) {
      addToCart(product)
    } else {
      setToast({ type: 'err', msg: `Barcode not found: ${barcode}` })
    }
  }

  // Filtered products
  const filtered = products.filter(p => {
    const matchCat = category === 'ALL' || p.category === category
    const s = search.toLowerCase()
    const matchSearch = !s || p.name.toLowerCase().includes(s) ||
      p.item_code.toLowerCase().includes(s) ||
      (p.barcode ?? '').includes(s)
    return matchCat && matchSearch
  })

  // Cart operations
  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(i => i.product.size_id === product.size_id)
      if (existing) {
        return prev.map(i =>
          i.product.size_id === product.size_id
            ? { ...i, quantity: i.quantity + 1 }
            : i
        )
      }
      return [...prev, { product, quantity: 1 }]
    })
  }

  const updateQty = (sizeId: number, delta: number) => {
    setCart(prev =>
      prev
        .map(i => i.product.size_id === sizeId ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i)
        .filter(i => i.quantity > 0)
    )
  }

  const removeFromCart = (sizeId: number) => {
    setCart(prev => prev.filter(i => i.product.size_id !== sizeId))
  }

  const cartTotal = cart.reduce((sum, i) => sum + i.product.selling_price * i.quantity, 0)

  // Payment validation
  const splitTotal = (parseFloat(cashAmount || '0') + parseFloat(cardAmount || '0') + parseFloat(upiAmount || '0'))
  const splitDiff   = paymentMode === 'SPLIT' ? Math.abs(splitTotal - cartTotal) : 0
  const canSubmit   = cart.length > 0 && activeStaffId &&
    (paymentMode !== 'SPLIT' || splitDiff < 0.01)

  const showToast = (type: 'ok' | 'err', msg: string) => {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  const handleCheckout = async () => {
    if (!canSubmit || isSubmitting) return
    setIsSubmitting(true)

    try {
      for (const item of cart) {
        const result = await window.posAPI.insertSale({
          staff_id: activeStaffId!,
          product_size_id: item.product.size_id,
          product_name: item.product.name,
          size_ml: item.product.size_ml,
          quantity: item.quantity,
          selling_price: item.product.selling_price,
          total_amount: item.product.selling_price * item.quantity,
          payment_mode: paymentMode,
          cash_amount: paymentMode === 'CASH'  ? cartTotal :
                       paymentMode === 'SPLIT' ? parseFloat(cashAmount || '0') : null,
          card_amount: paymentMode === 'CARD'  ? cartTotal :
                       paymentMode === 'SPLIT' ? parseFloat(cardAmount || '0') : null,
          upi_amount:  paymentMode === 'UPI'   ? cartTotal :
                       paymentMode === 'SPLIT' ? parseFloat(upiAmount  || '0') : null,
          scan_method: barcodeBuffer ? 'BARCODE_USB' : 'MANUAL',
          customer_name: customerName || null,
        })

        if (!result.ok) throw new Error(result.error ?? 'Unknown error')
      }

      setCart([])
      setCashAmount('')
      setCardAmount('')
      setUpiAmount('')
      setCustomerName('')
      setPaymentMode('CASH')
      showToast('ok', `Bill recorded — ₹${cartTotal.toFixed(2)}`)
      loadData()
    } catch (e) {
      showToast('err', String(e))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex h-full bg-slate-900 overflow-hidden">
      {/* Left: product list */}
      <div className="flex flex-col w-[55%] border-r border-slate-700">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-800 border-b border-slate-700">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search product or scan barcode..."
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
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors
                ${category === cat
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto p-2 grid grid-cols-3 gap-2 content-start scrollbar-thin">
          {filtered.map(product => (
            <button
              key={product.size_id}
              onClick={() => addToCart(product)}
              disabled={product.stock <= 0}
              className={`
                text-left p-2 rounded-lg border transition-all text-xs
                ${product.stock <= 0
                  ? 'opacity-40 cursor-not-allowed bg-slate-800 border-slate-700'
                  : 'bg-slate-800 border-slate-700 hover:border-indigo-500 hover:bg-slate-750 active:scale-95'}
              `}
            >
              <div className="font-medium text-slate-200 line-clamp-2 leading-tight mb-1">{product.name}</div>
              <div className="text-slate-400">{product.size_ml}ml</div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-emerald-400 font-semibold">{fmtRs(product.selling_price)}</span>
                <span className={`text-xs ${product.stock < 5 ? 'text-amber-400' : 'text-slate-500'}`}>
                  {product.stock} btl
                </span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-3 text-center text-slate-500 py-12 text-sm">
              No products found
            </div>
          )}
        </div>

        {/* Today's summary */}
        {totals && (
          <div className="flex gap-4 px-3 py-2 bg-slate-800 border-t border-slate-700 text-xs text-slate-400 flex-shrink-0">
            <span>{totals.bill_count} bills</span>
            <span>{totals.total_bottles} bottles</span>
            <span className="text-emerald-400 font-medium">{fmtRs(totals.gross_revenue)}</span>
            <span className="ml-auto text-slate-500">{new Date().toLocaleDateString('en-IN')}</span>
          </div>
        )}
      </div>

      {/* Right: cart + checkout */}
      <div className="flex flex-col w-[45%] bg-slate-850">
        {/* Staff selector */}
        <div className="px-3 py-2 bg-slate-800 border-b border-slate-700 flex items-center gap-2">
          <span className="text-xs text-slate-400">Cashier:</span>
          <select
            value={activeStaffId ?? ''}
            onChange={e => setActiveStaffId(parseInt(e.target.value))}
            className="flex-1 bg-slate-700 text-slate-200 text-xs rounded px-2 py-1 focus:outline-none"
          >
            {staff.filter(s => ['ADMIN', 'CASHIER'].includes(s.role)).map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
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
            <div className="space-y-2">
              {cart.map(item => (
                <div key={item.product.size_id} className="flex items-center gap-2 bg-slate-800 rounded-lg p-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-200 truncate">{item.product.name}</div>
                    <div className="text-xs text-slate-400">{item.product.size_ml}ml · {fmtRs(item.product.selling_price)} each</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => updateQty(item.product.size_id, -1)} className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-slate-300">
                      <Minus size={12} />
                    </button>
                    <span className="w-6 text-center text-sm font-medium text-white">{item.quantity}</span>
                    <button onClick={() => updateQty(item.product.size_id, +1)} className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-slate-300">
                      <Plus size={12} />
                    </button>
                  </div>
                  <div className="text-sm font-semibold text-emerald-400 w-16 text-right">
                    {fmtRs(item.product.selling_price * item.quantity)}
                  </div>
                  <button onClick={() => removeFromCart(item.product.size_id)} className="text-slate-600 hover:text-red-400">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Checkout panel */}
        {cart.length > 0 && (
          <div className="border-t border-slate-700 bg-slate-800 p-3 space-y-3 flex-shrink-0">
            {/* Total */}
            <div className="flex items-center justify-between">
              <span className="text-slate-300 font-medium">Total</span>
              <span className="text-2xl font-bold text-white">{fmtRs(cartTotal)}</span>
            </div>

            {/* Payment mode */}
            <div className="grid grid-cols-4 gap-1">
              {(['CASH', 'CARD', 'UPI', 'SPLIT'] as PaymentMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setPaymentMode(mode)}
                  className={`py-2 rounded text-xs font-medium transition-colors flex flex-col items-center gap-1
                    ${paymentMode === mode
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                >
                  {mode === 'CASH' && <Banknote size={14} />}
                  {mode === 'CARD' && <CreditCard size={14} />}
                  {mode === 'UPI'  && <Smartphone size={14} />}
                  {mode === 'SPLIT' && <span className="text-base leading-none">⅔</span>}
                  {mode}
                </button>
              ))}
            </div>

            {/* Split amounts */}
            {paymentMode === 'SPLIT' && (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Cash</label>
                  <input type="number" value={cashAmount} onChange={e => setCashAmount(e.target.value)} className="w-full bg-slate-700 text-white rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="0" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Card</label>
                  <input type="number" value={cardAmount} onChange={e => setCardAmount(e.target.value)} className="w-full bg-slate-700 text-white rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="0" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">UPI</label>
                  <input type="number" value={upiAmount} onChange={e => setUpiAmount(e.target.value)} className="w-full bg-slate-700 text-white rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="0" />
                </div>
                {splitDiff > 0.01 && (
                  <div className="col-span-3 text-xs text-red-400">
                    Difference: ₹{splitDiff.toFixed(2)} — amounts must equal total
                  </div>
                )}
              </div>
            )}

            {/* Customer name (optional) */}
            <input
              type="text"
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
              placeholder="Customer name (optional)"
              className="w-full bg-slate-700 text-slate-200 rounded px-2 py-1.5 text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />

            {/* Checkout button */}
            <button
              onClick={handleCheckout}
              disabled={!canSubmit || isSubmitting}
              className={`w-full py-3 rounded-lg font-bold text-base transition-all
                ${canSubmit && !isSubmitting
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white active:scale-[0.98]'
                  : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`}
            >
              {isSubmitting ? 'Recording...' : `Confirm Sale · ${fmtRs(cartTotal)}`}
            </button>
          </div>
        )}
      </div>

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 rounded-lg shadow-xl text-sm font-medium animate-in slide-in-from-bottom-2
          ${toast.type === 'ok' ? 'bg-emerald-800 text-emerald-100' : 'bg-red-900 text-red-100'}`}>
          {toast.type === 'ok'
            ? <CheckCircle size={16} className="text-emerald-400" />
            : <AlertCircle size={16} className="text-red-400" />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}
