"use client"

import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import { 
  ScanLine, Search, User, CreditCard, Banknote, 
  Smartphone, Split, Clock, Library, X, Plus, Minus,
  AlertCircle, Archive, Trash2, CheckCircle2, ShoppingCart
} from "lucide-react"

import { Button } from "@/components/ui/Button"
import { posCommit, posOpenTab, posSettleTab, posVoid } from "./actions"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProductSizeResult = {
  id: number
  sizeMl: number
  bottlesPerCase: number
  sellingPrice: string
  barcode: string | null
  product: { name: string; category: string; itemCode: string }
}

type MiscItemResult = {
  id: number
  name: string
  unit: string
  price: string
  category: string
  barcode: string | null
}

type SearchResult =
  | { kind: "LIQUOR"; item: ProductSizeResult }
  | { kind: "MISC"; item: MiscItemResult }

type CartLine = {
  key: string
  kind: "LIQUOR" | "MISC"
  productSizeId?: number
  miscItemId?: number
  itemName: string
  unitLabel?: string
  quantity: number
  unitPrice: number
}

type OpenTab = {
  id: number
  billNumber: string
  customerName: string | null
  netCollectible: string
  lines: Array<{
    id: number
    itemNameSnapshot: string
    quantity: number
    unitPrice: string
    lineTotal: string
  }>
}

type RecentBill = {
  id: number
  billNumber: string
  status: string
  netCollectible: string
  billedAt: string
  operator: { name: string }
}

type PaymentSplit = { cash: string; card: string; upi: string }

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function fmt(v: string | number): string {
  return "₹" + Number(v).toFixed(2)
}

function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0)
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PosPage(): JSX.Element {
  const barcodeRef = useRef<HTMLInputElement>(null)
  const cashReceivedRef = useRef<HTMLInputElement>(null)
  const [barcodeInput, setBarcodeInput] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [allItems, setAllItems] = useState<SearchResult[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [attribution, setAttribution] = useState<"COUNTER" | "CLERK">("COUNTER")
  const [clerks, setClerks] = useState<Array<{ id: number; name: string }>>([])
  const [selectedClerkId, setSelectedClerkId] = useState<number | undefined>()
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([])
  const [recentBills, setRecentBills] = useState<RecentBill[]>([])
  const [showTabs, setShowTabs] = useState(false)
  const [showRecent, setShowRecent] = useState(false)
  const [paymentMode, setPaymentMode] = useState<"CASH" | "CARD" | "UPI" | "SPLIT">("CASH")
  const [showTabSettle, setShowTabSettle] = useState<OpenTab | null>(null)
  const [showVoidModal, setShowVoidModal] = useState<RecentBill | null>(null)
  const [showMapBarcode, setShowMapBarcode] = useState<{ code: string } | null>(null)
  const [mapSearch, setMapSearch] = useState("")
  const [mapResults, setMapResults] = useState<SearchResult[]>([])
  const [mapTarget, setMapTarget] = useState<SearchResult | null>(null)
  const [payment, setPayment] = useState<PaymentSplit>({ cash: "", card: "", upi: "" })
  const [cashReceived, setCashReceived] = useState("")
  const [voidReason, setVoidReason] = useState("")
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [saveAsTab, setSaveAsTab] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL")
  const [isScannerFocused, setIsScannerFocused] = useState(true)

  const showToast = useCallback((msg: string, ok: boolean) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }, [])

  // Auto-focus logic: keep scanner focused if user clicks empty space
  useEffect(() => {
    const handleWindowClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'BUTTON', 'A', 'SELECT'].includes(target.tagName)) return
      // focus slightly delayed to prevent blur events from cancelling it
      setTimeout(() => barcodeRef.current?.focus(), 50)
    }
    window.addEventListener("click", handleWindowClick)
    return () => window.removeEventListener("click", handleWindowClick)
  }, [])

  // Load clerks
  useEffect(() => {
    fetch("/api/clerks")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setClerks(data)
      })
      .catch(() => {})
  }, [])

  // Load all products
  useEffect(() => {
    let mounted = true
    fetch(`/api/pos/items`)
      .then((r) => r.json())
      .then((items) => {
        if (!mounted) return
        if (Array.isArray(items)) {
          setAllItems(items)
          setSearchResults(items)
        }
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [])

  // Extract unique categories
  const categories = useMemo(() => {
    const cats = new Set<string>()
    allItems.forEach(r => {
      if (r.kind === "LIQUOR") cats.add(r.item.product.category)
      else if (r.kind === "MISC") cats.add(r.item.category)
    })
    return ["ALL", ...Array.from(cats).sort()]
  }, [allItems])

  // Filter based on search & category
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase()
    let filtered = allItems

    if (selectedCategory !== "ALL") {
      filtered = filtered.filter(r => {
        const cat = r.kind === "LIQUOR" ? r.item.product.category : r.item.category
        return cat === selectedCategory
      })
    }

    if (q) {
      filtered = filtered.filter((r) => {
        const name = r.kind === "LIQUOR" ? r.item.product.name : r.item.name
        return name.toLowerCase().includes(q) || (r.kind === "LIQUOR" && (r.item.barcode || "").includes(q))
      })
    }

    setSearchResults(filtered)
  }, [searchQuery, allItems, selectedCategory])

  // Map Barcode Debounce
  useEffect(() => {
    if (!showMapBarcode) return
    if (mapSearch.trim().length < 2) { setMapResults([]); return }
    const timer = setTimeout(() => {
      fetch(`/api/pos/search?q=${encodeURIComponent(mapSearch)}`)
        .then((r) => r.json())
        .then((data) => setMapResults(Array.isArray(data) ? data : []))
        .catch(() => {})
    }, 200)
    return () => clearTimeout(timer)
  }, [mapSearch, showMapBarcode])

  function addToCart(result: SearchResult): void {
    const key = result.kind === "LIQUOR" ? `ps-${result.item.id}` : `mi-${result.item.id}`
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key)
      if (existing) {
        return prev.map((l) => l.key === key ? { ...l, quantity: l.quantity + 1 } : l)
      }
      if (result.kind === "LIQUOR") {
        return [...prev, {
          key,
          kind: "LIQUOR",
          productSizeId: result.item.id,
          itemName: `${result.item.product.name} ${result.item.sizeMl}ml`,
          unitLabel: `${result.item.sizeMl}ml`,
          quantity: 1,
          unitPrice: Number(result.item.sellingPrice),
        }]
      }
      return [...prev, {
        key,
        kind: "MISC",
        miscItemId: result.item.id,
        itemName: result.item.name,
        unitLabel: result.item.unit,
        quantity: 1,
        unitPrice: Number(result.item.price),
      }]
    })
    setSearchQuery("")
    barcodeRef.current?.focus()
  }

  async function handleBarcodeEnter(): Promise<void> {
    const code = barcodeInput.trim()
    if (!code) return
    setBarcodeInput("")
    const res = await fetch(`/api/pos/barcode/${encodeURIComponent(code)}`)
    if (res.ok) {
      const data: SearchResult = await res.json()
      addToCart(data)
    } else if (res.status === 404) {
      setShowMapBarcode({ code })
      setMapSearch("")
      setMapResults([])
      setMapTarget(null)
    } else {
      showToast("Barcode lookup failed", false)
    }
  }

  function updateQty(key: string, delta: number): void {
    setCart((prev) => prev
      .map((l) => l.key === key ? { ...l, quantity: l.quantity + delta } : l)
      .filter((l) => l.quantity > 0))
  }

  function removeFromCart(key: string): void {
    setCart((prev) => prev.filter((l) => l.key !== key))
  }

  function applyPaymentMode(mode: "CASH" | "CARD" | "UPI" | "SPLIT"): void {
    setPaymentMode(mode)
    if (mode === "CASH") {
      setPayment({ cash: total.toFixed(2), card: "", upi: "" })
      setCashReceived("")
      setTimeout(() => cashReceivedRef.current?.focus(), 50)
      return
    }
    if (mode === "CARD") {
      setPayment({ cash: "", card: total.toFixed(2), upi: "" })
      setCashReceived("")
      return
    }
    if (mode === "UPI") {
      setPayment({ cash: "", card: "", upi: total.toFixed(2) })
      setCashReceived("")
      return
    }
  }

  function buildPayments(): Array<{ mode: string; amount: number }> {
    const items: Array<{ mode: string; amount: number }> = []
    if (Number(payment.cash) > 0) items.push({ mode: "CASH", amount: Number(payment.cash) })
    if (Number(payment.card) > 0) items.push({ mode: "CARD", amount: Number(payment.card) })
    if (Number(payment.upi) > 0) items.push({ mode: "UPI", amount: Number(payment.upi) })
    return items
  }

  async function handleCommit(): Promise<void> {
    if (cart.length === 0) return
    setLoading(true)

    if (saveAsTab) {
      const result = await posOpenTab({
        attributionType: attribution,
        clerkId: selectedClerkId,
        lines: cart.map((l) => ({
          productSizeId: l.kind === "LIQUOR" ? l.productSizeId : undefined,
          miscItemId: l.kind === "MISC" ? l.miscItemId : undefined,
          itemNameSnapshot: l.itemName,
          quantity: l.quantity,
          barcodeSnapshot: undefined,
          scanMethod: "BARCODE_USB",
        })),
      })
      setLoading(false)
      if (result.ok) {
        showToast(`Tab opened: ${result.data.billNumber}`, true)
        setCart([])
        setSaveAsTab(false)
        setPayment({ cash: "", card: "", upi: "" })
        setCashReceived("")
        setPaymentMode("CASH")
      } else {
        showToast(result.error, false)
      }
      return
    }

    if (!paymentValid) {
      setLoading(false)
      showToast("Payment total does not match", false)
      return
    }

    const result = await posCommit({
      attributionType: attribution,
      clerkId: selectedClerkId,
      lines: cart.map((l) => ({
        productSizeId: l.kind === "LIQUOR" ? l.productSizeId : undefined,
        miscItemId: l.kind === "MISC" ? l.miscItemId : undefined,
        itemNameSnapshot: l.itemName,
        quantity: l.quantity,
        barcodeSnapshot: undefined,
        scanMethod: "BARCODE_USB",
      })),
      payments: buildPayments(),
    })
    setLoading(false)
    if (result.ok) {
      showToast(`Bill committed: ${result.data.billNumber}`, true)
      setCart([])
      setPayment({ cash: "", card: "", upi: "" })
      setCashReceived("")
      setPaymentMode("CASH")
      refreshRecent()
      barcodeRef.current?.focus()
    } else {
      showToast(result.error, false)
    }
  }

  async function handleSettleTab(tab: OpenTab): Promise<void> {
    setLoading(true)
    const result = await posSettleTab(tab.id, buildPayments())
    setLoading(false)
    if (result.ok) {
      showToast("Tab settled", true)
      setShowTabSettle(null)
      setPayment({ cash: "", card: "", upi: "" })
      refreshTabs()
      refreshRecent()
    } else {
      showToast(result.error, false)
    }
  }

  async function handleVoid(bill: RecentBill): Promise<void> {
    if (!voidReason.trim()) { showToast("Enter void reason", false); return }
    setLoading(true)
    const result = await posVoid(bill.id, voidReason)
    setLoading(false)
    if (result.ok) {
      showToast("Bill voided", true)
      setShowVoidModal(null)
      setVoidReason("")
      refreshRecent()
    } else {
      showToast(result.error, false)
    }
  }

  async function handleMapBarcode(): Promise<void> {
    if (!showMapBarcode || !mapTarget) return
    const res = await fetch("/api/pos/map-barcode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: mapTarget.kind,
        id: mapTarget.item.id,
        barcode: showMapBarcode.code,
      }),
    })
    if (res.ok) {
      showToast("Barcode mapped", true)
      setShowMapBarcode(null)
      setMapTarget(null)
    } else {
      const err = await res.json()
      showToast(err.error ?? "Map failed", false)
    }
  }

  function refreshTabs(): void {
    fetch("/api/pos/open-tabs").then((r) => r.json()).then(setOpenTabs).catch(() => {})
  }

  function refreshRecent(): void {
    fetch("/api/pos/recent-bills").then((r) => r.json()).then(setRecentBills).catch(() => {})
  }

  const total = cartTotal(cart)
  const paymentSum = Number(payment.cash) + Number(payment.card) + Number(payment.upi)
  const changeDue = Math.max(0, Number(cashReceived || 0) - total)
  const isSplit = paymentMode === "SPLIT"
  const paymentValid = cart.length > 0 && Math.abs(paymentSum - total) < 0.01

  useEffect(() => {
    if (cart.length === 0) {
      setPayment({ cash: "", card: "", upi: "" })
      setCashReceived("")
      return
    }
    if (paymentMode === "SPLIT") return
    if (paymentMode === "CASH") setPayment({ cash: total.toFixed(2), card: "", upi: "" })
    if (paymentMode === "CARD") setPayment({ cash: "", card: total.toFixed(2), upi: "" })
    if (paymentMode === "UPI") setPayment({ cash: "", card: "", upi: total.toFixed(2) })
  }, [cart.length, paymentMode, total])

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden select-none">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-1/2 translate-x-1/2 z-50 rounded-xl px-6 py-4 shadow-2xl flex items-center gap-3 transition-all animate-in fade-in slide-in-from-top-4 ${
          toast.ok ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
        }`}>
          {toast.ok ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
          <span className="text-sm font-bold uppercase tracking-widest">{toast.msg}</span>
        </div>
      )}

      {/* Main Items Section (Left ~65%) */}
      <div className="flex-1 flex flex-col h-full bg-white relative shadow-lg z-10 border-r border-slate-200">
        
        {/* Top Search Bar & Utilities */}
        <header className="p-4 border-b border-slate-100 bg-white flex items-center justify-between gap-4 shrink-0 shadow-sm">
          <div className="flex items-center gap-2">
            <button 
              type="button" 
              onClick={() => {
                const el = document.getElementById("app-sidebar")
                el?.classList.toggle("hidden")
              }} 
              className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"
            >
              <Library size={20} />
            </button>
            <h1 className="text-lg font-black uppercase tracking-tight text-slate-800 ml-2">Mahavishnu POS</h1>
          </div>

          <div className="flex flex-1 max-w-xl gap-3 ml-8">
            <div className={`relative flex-1 flex items-center rounded-xl border-2 transition-all overflow-hidden ${
              isScannerFocused ? "border-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.1)] bg-emerald-50" : "border-slate-200 bg-slate-50"
            }`}>
              <div className={`p-3 ${isScannerFocused ? "text-emerald-600" : "text-slate-400"}`}>
                <ScanLine size={22} className={isScannerFocused ? "animate-pulse" : ""} />
              </div>
              <input
                ref={barcodeRef}
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleBarcodeEnter()}
                onFocus={() => setIsScannerFocused(true)}
                onBlur={() => setIsScannerFocused(false)}
                placeholder="Scan barcode..."
                className="w-full bg-transparent border-none p-0 py-3 text-lg font-bold text-slate-900 placeholder:text-slate-400 placeholder:font-medium focus:ring-0 focus:outline-none"
              />
            </div>
            
            <div className="relative flex-1 max-w-xs flex items-center rounded-xl border-2 border-slate-200 bg-slate-50 focus-within:border-blue-500 focus-within:bg-blue-50 overflow-hidden transition-colors">
              <div className="p-3 text-slate-400">
                <Search size={22} />
              </div>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Find item..."
                className="w-full bg-transparent border-none p-0 py-3 text-lg font-bold text-slate-900 placeholder:text-slate-400 placeholder:font-medium focus:ring-0 focus:outline-none"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="p-3 text-slate-400 hover:text-slate-600">
                  <X size={20} />
                </button>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setShowTabs(true); refreshTabs() }}
              className="flex items-center gap-2 rounded-xl bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-700 hover:bg-indigo-100 transition-colors uppercase tracking-wider"
            >
              <Library size={18} /> Tabs
            </button>
            <button
              type="button"
              onClick={() => { setShowRecent(true); refreshRecent() }}
              className="flex items-center gap-2 rounded-xl bg-orange-50 px-4 py-3 text-sm font-bold text-orange-700 hover:bg-orange-100 transition-colors uppercase tracking-wider"
            >
              <Clock size={18} /> Bills
            </button>
          </div>
        </header>

        {/* Categories Navbar */}
        <nav className="flex gap-2 overflow-x-auto p-4 border-b border-slate-100 bg-slate-50 shrink-0 no-scrollbar touch-pan-x">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`whitespace-nowrap px-6 py-3 rounded-full text-sm font-bold tracking-widest uppercase transition-all border-2 ${
                selectedCategory === cat 
                  ? "bg-slate-900 border-slate-900 text-white shadow-md shadow-slate-900/20" 
                  : "bg-white border-white text-slate-500 shadow-sm hover:border-slate-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </nav>

        {/* Items Grid */}
        <main className="flex-1 overflow-auto p-6 bg-slate-100/50">
          {searchResults.length === 0 ? (
            <div className="flex flex-col h-full items-center justify-center text-slate-400 space-y-4">
              <Archive size={48} className="opacity-20" />
              <p className="text-xl font-bold tracking-wide">No items found.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {searchResults.map((r) => (
                <button
                  key={`${r.kind}-${r.item.id}`}
                  onClick={() => addToCart(r)}
                  className="group flex flex-col items-start justify-between rounded-2xl border-2 border-transparent bg-white p-4 shadow-sm hover:border-emerald-500 hover:shadow-md hover:shadow-emerald-500/10 active:scale-95 transition-all text-left h-36"
                >
                  <div className="w-full">
                    <div className="flex items-start justify-between gap-1 w-full mb-1">
                      <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md ${
                        r.kind === "LIQUOR" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"
                      }`}>
                        {r.kind}
                      </span>
                      <span className="text-[11px] font-bold text-slate-400">{r.kind === "LIQUOR" ? `${r.item.sizeMl}ml` : r.item.unit}</span>
                    </div>
                    <p className="font-bold text-slate-800 text-sm line-clamp-2 leading-snug">
                      {r.kind === "LIQUOR" ? r.item.product.name : r.item.name}
                    </p>
                  </div>
                  <div className="w-full flex items-end justify-between mt-2">
                    <p className="text-xl font-black text-slate-900">{fmt(r.kind === "LIQUOR" ? r.item.sellingPrice : r.item.price)}</p>
                    <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-emerald-100 group-hover:text-emerald-600 transition-colors">
                      <Plus size={16} className="opacity-0 group-hover:opacity-100" />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Right Side: Cart & Checkout (~400px fixed) */}
      <aside className="w-[520px] shrink-0 flex flex-col h-full bg-white z-20 shadow-[-10px_0_30px_rgba(0,0,0,0.03)]">
        <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-black uppercase tracking-widest flex items-center gap-2 text-slate-800">
            <ShoppingCart size={22} className="text-slate-400" />
            Current Order
          </h2>
          <span className="bg-slate-200 text-slate-700 px-3 py-1 rounded-full text-sm font-bold">
            {cart.length} items
          </span>
        </div>

        {/* Cart Lines */}
        <div className="flex-1 overflow-auto p-2 space-y-2 bg-slate-50 no-scrollbar">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-300 space-y-4 p-8">
              <ShoppingCart size={48} className="opacity-30" />
              <p className="text-sm font-bold uppercase tracking-widest">Cart is empty</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {cart.map((line) => (
                <div key={line.key} className="flex items-center justify-between gap-4 px-4 py-3 bg-white">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-900 text-sm truncate">{line.itemName}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{fmt(line.unitPrice)} each • {line.unitLabel ?? ''}</p>
                    </div>
                    <button onClick={() => removeFromCart(line.key)} className="ml-2 p-2 text-slate-400 hover:text-red-500 rounded-md">
                      <Trash2 size={16} />
                    </button>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center bg-slate-100 rounded-md overflow-hidden">
                      <button onClick={() => updateQty(line.key, -1)} className="px-3 py-2 text-slate-700 hover:text-red-600"> <Minus size={16} /> </button>
                      <div className="px-4 text-center text-lg font-black text-slate-900">{line.quantity}</div>
                      <button onClick={() => updateQty(line.key, 1)} className="px-3 py-2 text-slate-700 hover:text-emerald-600"> <Plus size={16} /> </button>
                    </div>
                    <div className="text-right min-w-[90px]">
                      <div className="text-sm font-black text-slate-900">{fmt(line.unitPrice * line.quantity)}</div>
                      <div className="text-xs text-slate-400">{fmt(line.unitPrice)} ea</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Checkout Area */}
        <div className="bg-white shrink-0 shadow-[0_-10px_40px_rgba(0,0,0,0.06)] relative z-30">
          
          {/* Totals Banner */}
          <div className="px-6 py-4 flex items-center justify-between border-t border-slate-100 cursor-pointer" onClick={() => setCart([])}>
            <span className="text-sm font-black uppercase tracking-[0.2em] text-slate-400">Total amount</span>
            <span className="text-5xl font-black text-slate-900 tracking-tight">{fmt(total)}</span>
          </div>

          {/* Payment Tenders */}
          {cart.length > 0 && (
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100">
              <div className="grid grid-cols-4 gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => applyPaymentMode("CASH")}
                  className={`h-16 flex flex-col items-center justify-center gap-1 rounded-xl border-2 transition-all ${
                    paymentMode === "CASH" ? "border-amber-500 bg-amber-500 text-white shadow-lg shadow-amber-500/30" : "border-slate-200 bg-white text-slate-500 hover:border-amber-300 hover:text-amber-600"
                  }`}
                >
                  <Banknote size={20} />
                  <span className="text-[10px] font-black uppercase tracking-wider">Cash</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyPaymentMode("CARD")}
                  className={`h-16 flex flex-col items-center justify-center gap-1 rounded-xl border-2 transition-all ${
                    paymentMode === "CARD" ? "border-slate-800 bg-slate-800 text-white shadow-lg shadow-slate-800/30" : "border-slate-200 bg-white text-slate-500 hover:border-slate-400 hover:text-slate-800"
                  }`}
                >
                  <CreditCard size={20} />
                  <span className="text-[10px] font-black uppercase tracking-wider">Card</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyPaymentMode("UPI")}
                  className={`h-16 flex flex-col items-center justify-center gap-1 rounded-xl border-2 transition-all ${
                    paymentMode === "UPI" ? "border-emerald-500 bg-emerald-500 text-white shadow-lg shadow-emerald-500/30" : "border-slate-200 bg-white text-slate-500 hover:border-emerald-300 hover:text-emerald-600"
                  }`}
                >
                  <Smartphone size={20} />
                  <span className="text-[10px] font-black uppercase tracking-wider">UPI</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setPaymentMode("SPLIT"); setPayment({ cash: "", card: "", upi: "" }); setCashReceived("") }}
                  className={`h-16 flex flex-col items-center justify-center gap-1 rounded-xl border-2 transition-all ${
                    paymentMode === "SPLIT" ? "border-indigo-500 bg-indigo-500 text-white shadow-lg shadow-indigo-500/30" : "border-slate-200 bg-white text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
                  }`}
                >
                  <Split size={20} />
                  <span className="text-[10px] font-black uppercase tracking-wider">Split</span>
                </button>
              </div>

              {/* Cash specific UI */}
              {(paymentMode === "CASH" || (isSplit && Number(payment.cash) > 0)) && (
                <div className="space-y-3 animate-in slide-in-from-top-2 fade-in">
                  <div className="flex items-center gap-3">
                    <div className="relative flex-1">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black">₹</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={cashReceived}
                        onChange={(e) => setCashReceived(e.target.value)}
                        ref={cashReceivedRef}
                        placeholder="0.00"
                        className="w-full text-2xl font-black rounded-xl border-2 border-slate-300 bg-white px-10 py-3 text-slate-900 focus:border-amber-500 focus:ring-0 focus:outline-none transition-colors"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-white">Received</span>
                    </div>
                    {changeDue > 0 && (
                      <div className="flex flex-col items-end justify-center px-4 bg-emerald-100 rounded-xl h-full py-2">
                        <span className="text-[10px] font-black uppercase text-emerald-700 tracking-widest">Change</span>
                        <span className="text-xl font-black text-emerald-900">{fmt(changeDue)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Split specific UI */}
              {isSplit && (
                <div className="space-y-2 mt-2 animate-in slide-in-from-top-2 fade-in bg-white p-4 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
                    <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Total Entry</span>
                    <span className={`text-sm font-black ${paymentValid ? "text-emerald-600" : "text-amber-600"}`}>{fmt(paymentSum)} / {fmt(total)}</span>
                  </div>
                  {(["cash", "card", "upi"] as const).map((mode) => (
                    <div key={mode} className="flex items-center gap-3">
                      <label className="w-16 text-xs font-black uppercase tracking-wider text-slate-500">{mode}</label>
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">₹</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={payment[mode]}
                          onChange={(e) => setPayment((p) => ({ ...p, [mode]: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-8 py-2 text-base font-bold text-slate-900 focus:bg-white focus:border-indigo-500 focus:outline-none transition-colors"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Action Row */}
          <div className="p-6 pt-4 bg-white border-t border-slate-100 flex flex-col gap-4">
            
            <div className="flex items-center gap-4 justify-between">
              <div className="flex flex-col flex-1 pl-2">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2 flex items-center gap-1"><User size={12}/> Clerk</span>
                <div className="flex items-center gap-2 flex-wrap no-scrollbar pb-1">
                  <button
                    type="button"
                    onClick={() => { setAttribution("COUNTER"); setSelectedClerkId(undefined) }}
                    className={`flex-shrink-0 px-3 py-2 h-10 min-w-[80px] flex items-center justify-center rounded-lg text-sm font-bold transition-colors border-2 ${attribution === "COUNTER" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-white hover:border-slate-200"}`}
                  >
                    Counter
                  </button>
                  {clerks.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setAttribution("CLERK"); setSelectedClerkId(c.id) }}
                      className={`flex-shrink-0 px-3 py-2 h-10 min-w-[80px] flex items-center justify-center rounded-lg text-sm font-bold transition-colors border-2 ${selectedClerkId === c.id ? "bg-indigo-700 text-white border-indigo-700" : "bg-white text-slate-700 border-white hover:border-slate-200"}`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer pt-1 pr-2">
                <input type="checkbox" className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300" checked={saveAsTab} onChange={e => setSaveAsTab(e.target.checked)}/>
                <span className="text-sm font-bold text-slate-600">Save as Tab</span>
              </label>
            </div>

            <Button
              variant="primary"
              className={`w-full py-5 text-xl font-black tracking-widest uppercase transition-all rounded-2xl shadow-xl ${
                saveAsTab 
                  ? "bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30" 
                  : paymentValid || cart.length === 0
                    ? "bg-emerald-500 shadow-emerald-500/40 hover:bg-emerald-400 hover:shadow-emerald-500/50 hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm" 
                    : "bg-slate-300 cursor-not-allowed shadow-none text-slate-500"
              }`}
              onClick={handleCommit}
              disabled={loading || (!saveAsTab && !paymentValid) || cart.length === 0}
            >
              {loading ? "Processing..." : saveAsTab ? "Open Tab" : `Checkout ${fmt(total)}`}
            </Button>

          </div>
        </div>
      </aside>

      {/* --- Modals --- */}
      
      {/* Open Tabs Drawer */}
      {showTabs && (
        <Modal title="Open Tabs" onClose={() => setShowTabs(false)}>
          {openTabs.length === 0 ? (
            <div className="py-8 text-center text-slate-400">
              <Library size={48} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm font-bold uppercase tracking-widest">No open tabs</p>
            </div>
          ) : (
            <div className="space-y-3 mt-4 max-h-[60vh] overflow-y-auto pr-2 no-scrollbar">
              {openTabs.map((tab) => (
                <div key={tab.id} className="rounded-xl border-2 border-slate-100 bg-white p-4 hover:border-indigo-200 transition-colors">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xl font-black text-slate-900">{tab.billNumber}</p>
                      {tab.customerName && <p className="text-sm font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded inline-block mt-1">{tab.customerName}</p>}
                    </div>
                    <span className="text-2xl font-black text-slate-900">{fmt(tab.netCollectible)}</span>
                  </div>
                  <Button
                    size="lg"
                    className="mt-4 w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold"
                    onClick={() => { setShowTabSettle(tab); setShowTabs(false) }}
                  >
                    Settle Tab
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* Settle Tab Modal */}
      {showTabSettle && (
        <Modal title={`Settle Tab: ${showTabSettle.billNumber}`} onClose={() => setShowTabSettle(null)}>
          <div className="bg-slate-50 p-6 rounded-xl border border-slate-100 mb-6 text-center">
            <p className="text-sm font-bold uppercase text-slate-400 tracking-widest mb-1">Amount Due</p>
            <p className="text-4xl font-black text-emerald-600">{fmt(showTabSettle.netCollectible)}</p>
          </div>
          
          <div className="space-y-4 mb-6">
            {(["cash", "card", "upi"] as const).map((mode) => (
              <div key={mode} className="flex items-center gap-4">
                <label className="w-16 text-sm font-black uppercase tracking-wider text-slate-500">{mode}</label>
                <div className="relative flex-1">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₹</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={payment[mode]}
                    onChange={(e) => setPayment((p) => ({ ...p, [mode]: e.target.value }))}
                    placeholder="0.00"
                    className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-10 py-3 text-lg font-bold text-slate-900 focus:bg-white focus:border-emerald-500 focus:outline-none transition-colors"
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <Button
              variant="primary"
              className="flex-1 py-4 text-base font-black uppercase tracking-widest bg-emerald-500 hover:bg-emerald-400 shadow-md shadow-emerald-500/20"
              onClick={() => showTabSettle && handleSettleTab(showTabSettle)}
              disabled={loading}
            >
              {loading ? "Settling..." : "Confirm Settlement"}
            </Button>
            <Button variant="secondary" className="py-4 font-bold" onClick={() => setShowTabSettle(null)}>Cancel</Button>
          </div>
        </Modal>
      )}

      {/* Recent Bills */}
      {showRecent && (
        <Modal title="Recent Bills" onClose={() => setShowRecent(false)}>
          {recentBills.length === 0 ? (
            <div className="py-8 text-center text-slate-400">
              <Clock size={48} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm font-bold uppercase tracking-widest">No recent bills</p>
            </div>
          ) : (
            <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-2 no-scrollbar">
              {recentBills.map((b) => (
                <div key={b.id} className="rounded-xl border-2 border-slate-100 bg-white p-4 hover:border-slate-200 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-lg font-black text-slate-900">{b.billNumber}</p>
                      <p className="text-xs font-bold text-slate-400 mt-0.5">{new Date(b.billedAt).toLocaleTimeString("en-IN", { hour: '2-digit', minute: '2-digit' })} • {b.operator.name}</p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-widest ${b.status === "VOIDED" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                      {b.status}
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between mt-4">
                    <span className="text-xl font-black text-slate-900">{fmt(b.netCollectible)}</span>
                    {b.status === "COMMITTED" && (
                      <Button
                        variant="danger"
                        size="sm"
                        className="bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 border-none font-bold shadow-none"
                        onClick={() => { setShowVoidModal(b); setShowRecent(false) }}
                      >
                        Void Bill
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* Void Modal */}
      {showVoidModal && (
        <Modal title="Void Bill" onClose={() => setShowVoidModal(null)}>
          <div className="mb-6">
            <h3 className="text-2xl font-black text-red-600 mb-1">{showVoidModal.billNumber}</h3>
            <p className="text-slate-500 font-medium">Please enter a reason for voiding this bill.</p>
          </div>
          
          <input
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="Type reason here..."
            className="w-full mb-6 rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-lg font-medium text-slate-900 focus:border-red-500 focus:outline-none transition-colors"
            autoFocus
          />
          <div className="flex gap-3">
            <Button
              variant="danger"
              className="flex-1 py-4 text-base font-black uppercase tracking-widest bg-red-600 hover:bg-red-500 shadow-md shadow-red-600/20"
              onClick={() => showVoidModal && handleVoid(showVoidModal)}
              disabled={loading || voidReason.trim().length < 3}
            >
              {loading ? "Voiding..." : "Confirm Void"}
            </Button>
            <Button variant="secondary" className="py-4 font-bold" onClick={() => setShowVoidModal(null)}>Cancel</Button>
          </div>
        </Modal>
      )}

      {/* Map Barcode Modal */}
      {showMapBarcode && (
        <Modal title="Unknown Barcode Scanned" onClose={() => setShowMapBarcode(null)}>
          <div className="bg-amber-50 p-4 rounded-xl border border-amber-100 mb-5">
            <p className="text-sm font-medium text-amber-800">
              The barcode <code className="font-mono font-bold bg-amber-200/50 px-2 py-0.5 rounded text-amber-900 mx-1">{showMapBarcode.code}</code> is not linked to any item.
            </p>
            <p className="text-xs text-amber-600 mt-2 font-bold">Search and select an item to map this barcode.</p>
          </div>
          
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input
              value={mapSearch}
              onChange={(e) => { setMapSearch(e.target.value); setMapTarget(null) }}
              placeholder="Search by name..."
              className="w-full rounded-xl border-2 border-slate-200 bg-white pl-10 pr-4 py-3 text-sm font-bold text-slate-900 focus:border-indigo-500 focus:outline-none transition-colors"
              autoFocus
            />
          </div>
          
          <div className="mt-2 h-64 overflow-y-auto bg-slate-50 rounded-xl border border-slate-100 p-2 space-y-1 no-scrollbar">
            {mapResults.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm font-bold text-slate-400">
                {mapSearch.length < 2 ? "Type at least 2 letters..." : "No items found."}
              </div>
            ) : (
              mapResults.map((r) => (
                <button
                  key={`map-${r.kind}-${r.item.id}`}
                  onClick={() => setMapTarget(r)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left transition-all ${
                    mapTarget?.kind === r.kind && mapTarget.item.id === r.item.id 
                      ? "bg-indigo-600 text-white shadow-md" 
                      : "hover:bg-white text-slate-700 border border-transparent hover:border-slate-200"
                  }`}
                >
                  <div>
                    <p className={`font-bold ${mapTarget?.item.id === r.item.id ? "text-white" : "text-slate-900"}`}>
                      {r.kind === "LIQUOR" ? r.item.product.name : r.item.name}
                    </p>
                    <p className={`text-xs mt-0.5 ${mapTarget?.item.id === r.item.id ? "text-indigo-200" : "text-slate-500"}`}>
                      {r.kind === "LIQUOR" ? `${r.item.sizeMl}ml • ${fmt(r.item.sellingPrice)}` : `${r.item.unit} • ${fmt(r.item.price)}`}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
                    mapTarget?.item.id === r.item.id
                      ? "bg-indigo-500 text-white"
                      : r.kind === "LIQUOR" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
                  }`}>
                    {r.kind}
                  </span>
                </button>
              ))
            )}
          </div>
          
          <div className="mt-5 flex gap-3">
            <Button 
              variant="primary" 
              className={`flex-1 py-4 font-black uppercase tracking-widest transition-all ${mapTarget ? "bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-500/20" : "bg-slate-300 text-slate-500 cursor-not-allowed shadow-none"}`} 
              onClick={handleMapBarcode} 
              disabled={!mapTarget}
            >
              Map Barcode
            </Button>
            <Button variant="secondary" className="py-4 font-bold" onClick={() => setShowMapBarcode(null)}>Skip For Now</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Simple modal wrapper
// ---------------------------------------------------------------------------

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }): JSX.Element {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-0">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in transition-all" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-100 bg-white p-6 md:p-8 shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 transition-all">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">{title}</h2>
          <button 
            onClick={onClose} 
            className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-900 transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
