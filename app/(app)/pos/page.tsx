"use client"

import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import { 
  ScanLine, Search, User, CreditCard, Banknote, 
  Smartphone, Split, Clock, Library, X, Plus, Minus,
  AlertCircle, Archive, Trash2, CheckCircle2, ShoppingCart
} from "lucide-react"

import { Button } from "@/components/ui/Button"
import { postCommit, postOpenTab, postAddToTab, postSettleTab, postReturn, postCompute, postVoid, type PricedCart } from "./api-client"

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
  | { kind: "LIQUOR"; item: ProductSizeResult; stock: number }
  | { kind: "MISC"; item: MiscItemResult; stock: number }

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
  clerkId: number | null
  clerk?: { name: string }
  lines: Array<{
    id: number
    itemNameSnapshot: string
    quantity: number
    unitPrice: string
    lineTotal: string
    isVoidedLine: boolean
  }>
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
  const [pricing, setPricing] = useState<PricedCart | null>(null)
  const [pricingLoading, setPricingLoading] = useState(false)
  const [attribution, setAttribution] = useState<"COUNTER" | "CLERK">("COUNTER")
  const [clerks, setClerks] = useState<Array<{ id: number; name: string }>>([])
  const [selectedClerkId, setSelectedClerkId] = useState<number | undefined>()
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([])
  const [recentBills, setRecentBills] = useState<RecentBill[]>([])
  const [showTabs, setShowTabs] = useState(false)
  const [showRecent, setShowRecent] = useState(false)
  const [paymentMode, setPaymentMode] = useState<"CASH" | "CARD" | "UPI" | "SPLIT" | "TAB">("CASH")
  const [customerName, setCustomerName] = useState("")
  const [tabMode, setTabMode] = useState<"NEW" | "APPEND">("NEW")
  const [selectedTabId, setSelectedTabId] = useState<number | null>(null)
  const [showTabSettle, setShowTabSettle] = useState<OpenTab | null>(null)
  const [showMapBarcode, setShowMapBarcode] = useState<{ code: string } | null>(null)
  const [mapSearch, setMapSearch] = useState("")
  const [mapResults, setMapResults] = useState<SearchResult[]>([])
  const [mapTarget, setMapTarget] = useState<SearchResult | null>(null)
  const [payment, setPayment] = useState<PaymentSplit>({ cash: "", card: "", upi: "" })
  const [cashReceived, setCashReceived] = useState("")
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
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
    fetch(`/api/clerks`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setClerks(data)
          // Default to Counter if found
          const counterClerk = data.find(c => c.name.toLowerCase() === "counter")
          if (counterClerk) {
            setAttribution("COUNTER")
            setSelectedClerkId(counterClerk.id)
          }
        }
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

  useEffect(() => {
    if (cart.length === 0) {
      setPricing(null)
      setPricingLoading(false)
      return
    }

    let active = true
    setPricingLoading(true)
    const timer = setTimeout(() => {
      postCompute(
        cart.map((l) => ({
          kind: l.kind,
          productSizeId: l.kind === "LIQUOR" ? l.productSizeId : undefined,
          miscItemId: l.kind === "MISC" ? l.miscItemId : undefined,
          quantity: l.quantity,
        })),
      ).then((result) => {
        if (!active) return
        setPricingLoading(false)
        if (result.ok) {
          setPricing(result.data)
        } else {
          setPricing(null)
          showToast(result.error, false)
        }
      })
    }, 200)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [cart, showToast])

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

  // Load tabs when switching to APPEND mode
  useEffect(() => {
    if (paymentMode === "TAB" && tabMode === "APPEND") {
      refreshTabs()
    }
  }, [paymentMode, tabMode])

  function addToCart(result: SearchResult): void {
    if (result.stock <= 0) {
      showToast("Item out of stock", false)
      return
    }
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

    if (paymentMode === "TAB") {
      if (tabMode === "APPEND") {
        if (!selectedTabId) {
          setLoading(false)
          showToast("Select a tab to append to", false)
          return
        }
        const result = await postAddToTab(selectedTabId, {
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
          showToast(`Items added to tab: ${result.data.billNumber}`, true)
          setCart([])
          setCustomerName("")
          setTabMode("NEW")
          setSelectedTabId(null)
          setPaymentMode("CASH")
          setPayment({ cash: "", card: "", upi: "" })
          setCashReceived("")
          refreshTabs()
        } else {
          showToast(result.error, false)
        }
        return
      }

      const result = await postOpenTab({
        attributionType: attribution,
        clerkId: selectedClerkId,
        customerName: customerName.trim() || undefined,
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
        setCustomerName("")
        setTabMode("NEW")
        setSelectedTabId(null)
        setPaymentMode("CASH")
        setPayment({ cash: "", card: "", upi: "" })
        setCashReceived("")
        refreshTabs()
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

    const result = await postCommit({
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
      refreshItems()
      barcodeRef.current?.focus()
    } else {
      showToast(result.error, false)
    }
  }

  async function handleSettleTab(tab: OpenTab): Promise<void> {
    setLoading(true)
    const result = await postSettleTab(tab.id, buildPayments())
    setLoading(false)
    if (result.ok) {
      showToast("Tab settled", true)
      setShowTabSettle(null)
      setPayment({ cash: "", card: "", upi: "" })
      refreshTabs()
      refreshRecent()
      refreshItems()
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


  async function handleProcessReturn(): Promise<void> {
    if (cart.length === 0) return
    if (!selectedClerkId) {
      showToast("Select a clerk before processing a return", false)
      return
    }

    setLoading(true)
    const result = await postReturn({
      clerkId: selectedClerkId,
      reason: "POS Return",
      lines: cart.map((l) => ({
        productSizeId: l.kind === "LIQUOR" ? l.productSizeId : undefined,
        miscItemId: l.kind === "MISC" ? l.miscItemId : undefined,
        itemNameSnapshot: l.itemName,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })),
    })
    setLoading(false)
    if (result.ok) {
      showToast("Return processed", true)
      setCart([])
      refreshItems()
      refreshRecent()
    } else {
      showToast(result.error, false)
    }
  }

  function refreshItems(): void {
    fetch("/api/pos/items")
      .then((r) => r.json())
      .then((items) => { if (Array.isArray(items)) setAllItems(items) })
      .catch(() => {})
  }

  function refreshTabs(): void {
    fetch("/api/pos/open-tabs").then((r) => r.json()).then(setOpenTabs).catch(() => {})
  }

  function refreshRecent(): void {
    fetch("/api/pos/recent-bills").then((r) => r.json()).then(setRecentBills).catch(() => {})
  }

  async function handleVoidBill(billId: number, billNumber: string): Promise<void> {
    const reason = window.prompt(`Void reason for ${billNumber}:`)
    if (!reason?.trim()) return
    setLoading(true)
    const result = await postVoid(billId, reason.trim())
    setLoading(false)
    if (!result.ok) { showToast(result.error, false); return }
    showToast(`${billNumber} voided`, true)
    setShowRecent(false)
    refreshRecent()
  }

  const localTotal = cartTotal(cart)
  const total = pricing?.total ?? localTotal
  const pricingWarnings = pricing?.warnings ?? []
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
    if (paymentMode === "CASH") {
      setPayment({ cash: total.toFixed(2), card: "", upi: "" })
      setTabMode("NEW")
      setSelectedTabId(null)
    }
    if (paymentMode === "CARD") {
      setPayment({ cash: "", card: total.toFixed(2), upi: "" })
      setTabMode("NEW")
      setSelectedTabId(null)
    }
    if (paymentMode === "UPI") {
      setPayment({ cash: "", card: "", upi: total.toFixed(2) })
      setTabMode("NEW")
      setSelectedTabId(null)
    }
  }, [cart.length, paymentMode, total])

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden select-none">
      {/* Toast - Better positioning */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] rounded-lg px-4 py-3 shadow-xl flex items-center gap-3 transition-all animate-in slide-in-from-bottom-4 ${
          toast.ok ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
        }`}>
          {toast.ok ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span className="text-xs font-bold uppercase tracking-widest">{toast.msg}</span>
        </div>
      )}

      {/* Main Items Section (Left) */}
      <div className="flex-1 flex flex-col h-full bg-white relative z-10 border-r border-slate-100 overflow-hidden">
        
        {/* Top Search Bar & Utilities - Compact */}
        <header className="p-3 border-b border-slate-100 bg-white flex items-center justify-between gap-4 shrink-0">
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

          <div className="flex flex-1 max-w-2xl gap-4 ml-8">
            <div className={`relative flex-[3] flex items-center rounded-2xl border-2 transition-all overflow-hidden ${
              isScannerFocused ? "border-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.15)] bg-emerald-50 scale-[1.02]" : "border-slate-200 bg-slate-50 hover:border-emerald-300"
            }`}>
              <div className={`pl-4 pr-3 ${isScannerFocused ? "text-emerald-600" : "text-slate-400"}`}>
                <ScanLine size={28} className={isScannerFocused ? "animate-pulse" : ""} />
              </div>
              <input
                ref={barcodeRef}
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleBarcodeEnter()}
                onFocus={() => setIsScannerFocused(true)}
                onBlur={() => setIsScannerFocused(false)}
                placeholder="Scan Barcode..."
                className="w-full bg-transparent border-none p-0 py-4 text-xl font-black text-slate-900 placeholder:text-slate-400 placeholder:font-bold focus:ring-0 focus:outline-none tracking-wider"
              />
            </div>
            
            <div className="relative flex-[2] flex items-center rounded-xl border-2 border-slate-200 bg-slate-50 focus-within:border-blue-500 focus-within:bg-blue-50 overflow-hidden transition-colors hover:border-slate-300">
              <div className="pl-4 pr-2 text-slate-400">
                <Search size={20} />
              </div>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search inventory..."
                className="w-full bg-transparent border-none p-0 py-3 text-base font-bold text-slate-900 placeholder:text-slate-400 placeholder:font-medium focus:ring-0 focus:outline-none"
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
              {searchResults.map((r) => {
                const outOfStock = r.stock <= 0
                return (
                  <button
                    key={`${r.kind}-${r.item.id}`}
                    onClick={() => addToCart(r)}
                    disabled={outOfStock}
                    className={`group flex flex-col items-start justify-between rounded-xl border p-4 active:scale-95 transition-all text-left h-36 ${
                      outOfStock 
                        ? "bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed" 
                        : "bg-white border-slate-200 hover:border-emerald-500 hover:shadow-md hover:-translate-y-0.5"
                    }`}
                  >
                    <div className="w-full">
                      <div className="flex items-start justify-between gap-1 w-full mb-2">
                        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md ${
                          outOfStock 
                            ? "bg-slate-200 text-slate-500" 
                            : r.kind === "LIQUOR" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"
                        }`}>
                          {outOfStock ? "OUT" : r.kind}
                        </span>
                        <span className="text-xs font-bold text-slate-400">{r.kind === "LIQUOR" ? `${r.item.sizeMl}ml` : r.item.unit}</span>
                      </div>
                      <p className={`font-black text-sm line-clamp-2 leading-snug ${outOfStock ? "text-slate-400" : "text-slate-800"}`}>
                        {r.kind === "LIQUOR" ? r.item.product.name : r.item.name}
                      </p>
                    </div>
                    <div className="w-full flex items-end justify-between mt-1">
                      <div>
                        <p className={`text-xl font-black tracking-tight ${outOfStock ? "text-slate-400" : "text-slate-900"}`}>
                          {fmt(r.kind === "LIQUOR" ? r.item.sellingPrice : r.item.price)}
                        </p>
                        {!outOfStock && r.kind === "LIQUOR" && (
                          <p className="text-[10px] font-bold text-emerald-600 uppercase mt-0.5 tracking-wider">
                            {r.stock} left
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </main>
      </div>

      {/* Right Side: Cart & Checkout (Strict width to prevent cut-off) */}
      <aside className="w-[420px] shrink-0 flex flex-col h-full bg-white border-l border-slate-200 overflow-hidden shadow-xl z-20">
        <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
          <h2 className="text-base font-black uppercase tracking-widest flex items-center gap-2 text-slate-800">
            <ShoppingCart size={20} className="text-slate-400" />
            Current Order
          </h2>
          <span className="bg-slate-200 text-slate-700 px-3 py-1 rounded-md text-xs font-bold tracking-wider">
            {cart.length} ITEMS
          </span>
        </div>

        {/* Cart Lines */}
        <div className="flex-1 overflow-auto bg-slate-50 no-scrollbar">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-300 space-y-4 p-4">
              <ShoppingCart size={64} className="opacity-20 mb-2" />
              <p className="text-sm font-bold uppercase tracking-widest">Cart is empty</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100/50 p-2 space-y-2">
              {cart.map((line) => (
                <div key={line.key} className="flex flex-col gap-3 px-4 py-4 bg-white rounded-xl shadow-sm border border-slate-100">
                  <div className="flex items-start justify-between min-w-0">
                    <div className="flex-1 min-w-0 pr-4">
                      <p className="font-black text-slate-900 text-base leading-snug line-clamp-2">{line.itemName}</p>
                      <p className="text-sm font-semibold text-slate-400 mt-1">{fmt(line.unitPrice)} each {line.unitLabel ? `• ${line.unitLabel}` : ''}</p>
                    </div>
                    <button onClick={() => removeFromCart(line.key)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={20} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-50">
                    <div className="flex items-center bg-slate-100 rounded-lg overflow-hidden border border-slate-200">
                      <button onClick={() => updateQty(line.key, -1)} className="px-5 py-3 text-slate-600 hover:text-red-600 hover:bg-slate-200 transition-colors"> <Minus size={18} /> </button>
                      <div className="w-12 text-center text-xl font-black text-slate-900">{line.quantity}</div>
                      <button onClick={() => updateQty(line.key, 1)} className="px-5 py-3 text-slate-600 hover:text-emerald-600 hover:bg-slate-200 transition-colors"> <Plus size={18} /> </button>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-black text-slate-900 tracking-tight">{fmt(line.unitPrice * line.quantity)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Checkout Area */}
        <div className="bg-white shrink-0 border-t">
          
          {/* Totals Banner - Compact */}
          <div className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors border-t-2 border-slate-900" onClick={() => setCart([])}>
            <span className="text-sm font-black uppercase tracking-widest text-slate-500">Total Due</span>
            <span className="text-xl font-black text-slate-900 tracking-tighter">{pricingLoading ? "..." : fmt(total)}</span>
          </div>

          {/* Payment Tenders - Massive for Usability */}
          {cart.length > 0 && (
            <div className="px-5 py-4 bg-slate-50 border-t border-slate-100">
              {pricingWarnings.length > 0 && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700 shadow-sm">
                  {pricingWarnings.map((w, idx) => (
                    <div key={`${idx}-${w}`}>{w}</div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-5 gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => applyPaymentMode("CASH")}
                  className={`h-16 flex flex-col items-center justify-center rounded-xl border-2 transition-all hover:-translate-y-0.5 ${
                    paymentMode === "CASH" ? "border-amber-500 bg-amber-500 text-white shadow-md shadow-amber-500/30" : "border-slate-200 bg-white text-slate-500 hover:border-amber-300"
                  }`}
                >
                  <Banknote size={20} className="mb-1" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Cash</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyPaymentMode("CARD")}
                  className={`h-16 flex flex-col items-center justify-center rounded-xl border-2 transition-all hover:-translate-y-0.5 ${
                    paymentMode === "CARD" ? "border-slate-900 bg-slate-900 text-white shadow-md shadow-slate-900/30" : "border-slate-200 bg-white text-slate-500 hover:border-slate-400"
                  }`}
                >
                  <CreditCard size={20} className="mb-1" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Card</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyPaymentMode("UPI")}
                  className={`h-16 flex flex-col items-center justify-center rounded-xl border-2 transition-all hover:-translate-y-0.5 ${
                    paymentMode === "UPI" ? "border-emerald-600 bg-emerald-600 text-white shadow-md shadow-emerald-600/30" : "border-slate-200 bg-white text-slate-500 hover:border-emerald-400"
                  }`}
                >
                  <Smartphone size={20} className="mb-1" />
                  <span className="text-[10px] font-black uppercase tracking-widest">UPI</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setPaymentMode("SPLIT"); setPayment({ cash: "", card: "", upi: "" }); setCashReceived("") }}
                  className={`h-16 flex flex-col items-center justify-center rounded-xl border-2 transition-all hover:-translate-y-0.5 ${
                    paymentMode === "SPLIT" ? "border-indigo-600 bg-indigo-600 text-white shadow-md shadow-indigo-600/30" : "border-slate-200 bg-white text-slate-500 hover:border-indigo-400"
                  }`}
                >
                  <Split size={20} className="mb-1" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Split</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setPaymentMode("TAB"); setPayment({ cash: "", card: "", upi: "" }); setCashReceived("") }}
                  className={`h-16 flex flex-col items-center justify-center rounded-xl border-2 transition-all hover:-translate-y-0.5 ${
                    paymentMode === "TAB" ? "border-indigo-900 bg-indigo-900 text-white shadow-md shadow-indigo-900/30" : "border-slate-200 bg-white text-slate-500 hover:border-indigo-400"
                  }`}
                >
                  <Library size={20} className="mb-1" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Tab</span>
                </button>
              </div>

              {/* Tab specific UI */}
              {paymentMode === "TAB" && (
                <div className="mb-3 space-y-3 animate-in slide-in-from-top-2 fade-in">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setTabMode("NEW"); setSelectedTabId(null); setCustomerName("") }}
                      className={`flex-1 py-2 px-3 rounded-lg font-bold text-sm transition-colors border-2 ${
                        tabMode === "NEW" 
                          ? "bg-indigo-600 text-white border-indigo-600" 
                          : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"
                      }`}
                    >
                      New Tab
                    </button>
                    <button
                      type="button"
                      onClick={() => { setTabMode("APPEND"); setCustomerName("") }}
                      className={`flex-1 py-2 px-3 rounded-lg font-bold text-sm transition-colors border-2 ${
                        tabMode === "APPEND" 
                          ? "bg-indigo-600 text-white border-indigo-600" 
                          : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"
                      }`}
                    >
                      Append to Tab
                    </button>
                  </div>
                  
                  {tabMode === "NEW" && (
                    <div>
                      <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Customer / Table Name</label>
                      <input
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="E.g. Table 4, Mr. Rao..."
                        className="w-full rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 focus:border-indigo-500 focus:outline-none transition-colors"
                      />
                    </div>
                  )}
                  
                  {tabMode === "APPEND" && (
                    <div>
                      <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Select Tab to Add To</label>
                      {openTabs.length === 0 ? (
                        <div className="w-full rounded-lg border-2 border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-400 text-center">
                          No open tabs available
                        </div>
                      ) : (
                        <select
                          value={selectedTabId || ""}
                          onChange={(e) => setSelectedTabId(e.target.value ? Number(e.target.value) : null)}
                          className="w-full rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 focus:border-indigo-500 focus:outline-none transition-colors"
                        >
                          <option value="">-- Select a tab --</option>
                          {openTabs.map((tab) => (
                            <option key={tab.id} value={tab.id}>
                              {tab.billNumber} {tab.customerName ? `- ${tab.customerName}` : ""} ({fmt(tab.netCollectible)})
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              )}

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
                        className="w-full text-2xl font-black rounded-xl border-2 border-slate-300 bg-white px-5 py-3 text-slate-900 focus:border-amber-500 focus:ring-0 focus:outline-none transition-colors"
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
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-base font-bold text-slate-900 focus:bg-white focus:border-indigo-500 focus:outline-none transition-colors"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Action Row */}
          <div className="p-5 bg-white border-t border-slate-200 flex flex-col gap-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
            
            <div className="flex flex-col mb-1">
              <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-3 flex items-center gap-2"><User size={14}/> Attribution</span>
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
                {clerks.map(c => {
                  const isCounter = c.name.toLowerCase() === "counter"
                  const isActive = selectedClerkId === c.id
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { 
                        setAttribution(isCounter ? "COUNTER" : "CLERK")
                        setSelectedClerkId(c.id) 
                      }}
                      className={`flex-shrink-0 px-4 py-2 h-12 min-w-[90px] flex items-center justify-center rounded-xl text-sm font-black transition-all border-2 ${
                        isActive 
                          ? (isCounter ? "bg-slate-900 text-white border-slate-900 shadow-md" : "bg-indigo-700 text-white border-indigo-700 shadow-md") 
                          : "bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-100"
                      }`}
                    >
                      {c.name}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="primary"
                className={`w-full py-4 text-lg font-black tracking-widest uppercase transition-all rounded-xl shadow-lg ${
                  paymentMode === "TAB" 
                    ? "bg-indigo-600 hover:bg-indigo-700" 
                    : paymentValid || cart.length === 0
                      ? "bg-emerald-600 hover:bg-emerald-700" 
                      : "bg-slate-300 cursor-not-allowed text-slate-500 shadow-none"
                }`}
                onClick={handleCommit}
                disabled={loading || (paymentMode !== "TAB" && !paymentValid) || cart.length === 0 || !selectedClerkId}
              >
                {loading ? "..." : paymentMode === "TAB" ? "Tab It" : `Pay`}
              </Button>

              <Button
                variant="danger"
                className={`w-full py-4 text-lg font-black tracking-widest uppercase transition-all rounded-xl shadow-lg ${
                  cart.length > 0 && selectedClerkId
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-slate-300 cursor-not-allowed text-slate-500 shadow-none"
                }`}
                onClick={handleProcessReturn}
                disabled={loading || cart.length === 0 || !selectedClerkId}
              >
                {loading ? "..." : "Return"}
              </Button>
            </div>

          </div>
        </div>
      </aside>

      {/* --- Modals --- */}
      
      {/* Open Tabs Drawer */}
      {showTabs && (
        <Modal title="Open Tabs" onClose={() => setShowTabs(false)}>
          {openTabs.length === 0 ? (
            <div className="py-3 text-center text-slate-400">
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
            <p className="text-xl font-black text-emerald-600">{fmt(showTabSettle.netCollectible)}</p>
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
                    className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-5 py-3 text-lg font-bold text-slate-900 focus:bg-white focus:border-emerald-500 focus:outline-none transition-colors"
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
            <div className="py-3 text-center text-slate-400">
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
                      <p className="text-xs font-bold text-slate-400 mt-0.5">
                        {new Date(b.billedAt).toLocaleTimeString("en-IN", { hour: '2-digit', minute: '2-digit' })} • {b.clerk?.name || "Counter"}
                      </p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-widest ${b.status === "VOIDED" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                      {b.status}
                    </span>
                  </div>
                  
                  <div className="mt-4 border-t border-slate-50 pt-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Bill Items</p>
                    <div className="space-y-2">
                      {b.lines.map(line => (
                        <div key={line.id} className={`flex items-center justify-between text-sm ${line.isVoidedLine ? "opacity-40 line-through" : ""}`}>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-slate-800 truncate">{line.itemNameSnapshot}</p>
                            <p className="text-[10px] text-slate-400">Qty: {line.quantity} • {fmt(line.unitPrice)}</p>
                          </div>
                          <div className="flex items-center gap-3">
                             <span className="font-black text-slate-900">{fmt(line.lineTotal)}</span>
                             {line.isVoidedLine && (
                               <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 bg-slate-100 px-2 py-1 rounded">
                                 Returned
                               </span>
                             )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-6 pt-3 border-t border-slate-50">
                    <span className="text-xl font-black text-slate-900">{fmt(b.netCollectible)}</span>
                    <div className="flex gap-2">
                      {b.status === "COMMITTED" && (
                        <button
                          onClick={() => handleVoidBill(b.id, b.billNumber)}
                          disabled={loading}
                          className="text-[10px] font-black uppercase tracking-widest text-red-600 hover:text-red-800 px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                          Void
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
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
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-100 bg-white p-6 md:p-4 shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 transition-all">
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
