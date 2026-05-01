"use client"

import { useCallback, useEffect, useRef, useState } from "react"

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

  const showToast = useCallback((msg: string, ok: boolean) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }, [])

  // Focus barcode input on mount
  useEffect(() => {
    barcodeRef.current?.focus()
  }, [])

  // Load clerks
  useEffect(() => {
    fetch("/api/clerks").then((r) => r.json()).then(setClerks).catch(() => {})
  }, [])

  function toggleSidebar(): void {
    const el = document.getElementById("app-sidebar")
    if (!el) return
    el.classList.toggle("hidden")
  }

  // Search products
  // Load all products once and filter client-side
  useEffect(() => {
    let mounted = true
    fetch(`/api/pos/items`).then((r) => r.json()).then((items: SearchResult[]) => {
      if (!mounted) return
      setAllItems(items)
      setSearchResults(items)
    }).catch(() => {})
    return () => { mounted = false }
  }, [])

  // Keep searchResults as a filtered view of allItems (client-side)
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) { setSearchResults(allItems); return }
    setSearchResults(allItems.filter((r) => {
      const name = r.kind === "LIQUOR" ? r.item.product.name : r.item.name
      return name.toLowerCase().includes(q) || (r.kind === "LIQUOR" && (r.item.barcode || "").includes(q))
    }))
  }, [searchQuery, allItems])

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
    setSearchResults([])
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

  function selectCounter(): void {
    setAttribution("COUNTER")
    setSelectedClerkId(undefined)
  }

  function selectClerk(id: number): void {
    setAttribution("CLERK")
    setSelectedClerkId(id)
  }

  function applyPaymentMode(mode: "CASH" | "CARD" | "UPI" | "SPLIT"): void {
    setPaymentMode(mode)
    if (mode === "CASH") {
      setPayment({ cash: total.toFixed(2), card: "", upi: "" })
      setCashReceived(total.toFixed(2))
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
    <div className="flex h-screen overflow-hidden bg-[#f8fafc]">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 rounded-lg px-4 py-3 text-xs font-bold uppercase tracking-widest shadow-lg ${toast.ok ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.msg}
        </div>
      )}

      {/* Left panel: inputs */}
      <div className="flex w-72 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button type="button" onClick={toggleSidebar} className="rounded border border-slate-200 px-2 py-1 text-[10px] font-bold uppercase text-slate-500 hover:border-slate-900 hover:text-slate-900">Toggle Sidebar</button>
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">POS Console</h2>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setShowTabs(true); refreshTabs() }}
                className="rounded-md border border-slate-200 px-2 py-1 text-[10px] font-bold uppercase text-slate-500 hover:border-slate-900 hover:text-slate-900"
              >
                Tabs
              </button>
              <button
                type="button"
                onClick={() => { setShowRecent(true); refreshRecent() }}
                className="rounded-md border border-slate-200 px-2 py-1 text-[10px] font-bold uppercase text-slate-500 hover:border-slate-900 hover:text-slate-900"
              >
                Bills
              </button>
            </div>
          </div>
          <input
            ref={barcodeRef}
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleBarcodeEnter()}
            placeholder="Scan barcode…"
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-900 focus:outline-none"
          />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name…"
            className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-900 focus:outline-none"
          />
        </div>
        <div className="flex-1 px-4 py-4">
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Scanner Ready</p>
            <p className="mt-2 text-xs text-slate-500">Scan or search to add items.</p>
          </div>
        </div>
      </div>

      {/* Center: Results */}
      <div className="flex flex-1 flex-col">
        <div className="border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-500">Items</h3>
            <span className="text-xs font-semibold text-slate-400">{searchResults.length} items</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {searchResults.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-slate-400">No items. Import products or scan a barcode.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {searchResults.map((r) => (
                <button
                  key={`${r.kind}-${r.item.id}`}
                  onClick={() => addToCart(r)}
                  className="group rounded border border-slate-100 bg-white p-3 text-left text-xs hover:shadow"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-900 truncate">{r.kind === "LIQUOR" ? r.item.product.name : r.item.name}</p>
                    <span className={`ml-2 text-[10px] font-bold uppercase ${r.kind === "LIQUOR" ? "text-emerald-700" : "text-blue-700"}`}>
                      {r.kind}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">{r.kind === "LIQUOR" ? `${r.item.sizeMl}ml` : r.item.unit}</p>
                  <p className="mt-2 font-black text-slate-900">{fmt(r.kind === "LIQUOR" ? r.item.sellingPrice : r.item.price)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: Cart + Checkout */}
      <div className="flex w-[26%] min-w-[320px] max-w-[420px] flex-col border-l border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-500">Cart</h3>
            <span className="text-xs font-semibold text-slate-400">{cart.length} items</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {cart.length === 0 ? (
            <p className="mt-10 text-center text-sm text-slate-400">Cart is empty</p>
          ) : (
            <div className="space-y-3">
              {cart.map((line) => (
                <div key={line.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                          line.kind === "LIQUOR" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"
                        }`}>
                          {line.kind}
                        </span>
                        <span className="text-xs font-bold text-slate-900">{line.itemName}</span>
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500">{fmt(line.unitPrice)} per unit</p>
                    </div>
                    <button onClick={() => removeFromCart(line.key)} className="text-xs font-bold text-slate-400 hover:text-red-500">✕</button>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateQty(line.key, -1)} className="h-7 w-7 rounded-md border border-slate-200 bg-white text-slate-900 hover:bg-slate-100">−</button>
                      <span className="w-6 text-center text-xs font-bold text-slate-900">{line.quantity}</span>
                      <button onClick={() => updateQty(line.key, 1)} className="h-7 w-7 rounded-md border border-slate-200 bg-white text-slate-900 hover:bg-slate-100">+</button>
                    </div>
                    <span className="text-sm font-black text-slate-900">{fmt(line.unitPrice * line.quantity)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Total</span>
            <span className="text-2xl font-black text-slate-900">{fmt(total)}</span>
          </div>

          <div className="mb-4 flex items-center gap-2">
            <input type="checkbox" checked={saveAsTab} onChange={(e) => setSaveAsTab(e.target.checked)} />
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Save as Tab</span>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2">
            <Button
              variant="primary"
              size="lg"
              className="bg-emerald-600 text-white hover:bg-emerald-500"
              onClick={handleCommit}
              disabled={loading || (!saveAsTab && !paymentValid)}
            >
              {loading ? "Processing" : saveAsTab ? "Open Tab" : "Commit Bill"}
            </Button>
            <Button variant="secondary" size="lg" onClick={() => setCart([])}>
              Clear
            </Button>
          </div>

          {!saveAsTab && (
            <div className="space-y-3">
              <div>
                <p className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Clerks</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={selectCounter}
                    className={`rounded-md border px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${
                      attribution === "COUNTER" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-500 hover:border-slate-900 hover:text-slate-900"
                    }`}
                  >
                    Counter
                  </button>
                  {clerks.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectClerk(c.id)}
                      className={`rounded-md border px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${
                        attribution === "CLERK" && selectedClerkId === c.id
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 text-slate-500 hover:border-slate-900 hover:text-slate-900"
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>

              {isSplit && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="space-y-2">
                    {(["cash", "card", "upi"] as const).map((mode) => (
                      <div key={mode} className="flex items-center gap-2">
                        <label className="w-12 text-[10px] font-bold uppercase text-slate-500">{mode}</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={payment[mode]}
                          onChange={(e) => setPayment((p) => ({ ...p, [mode]: e.target.value }))}
                          placeholder="0.00"
                          className="flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                  <p className={`mt-2 text-[10px] font-bold uppercase ${paymentValid ? "text-emerald-600" : "text-amber-600"}`}>
                    Entered {fmt(paymentSum)} / Required {fmt(total)}
                  </p>
                </div>
              )}

              {(paymentMode === "CASH" || (isSplit && Number(payment.cash) > 0)) && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center gap-2">
                    <label className="w-24 text-[10px] font-bold uppercase text-slate-500">Cash received</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={cashReceived}
                      onChange={(e) => setCashReceived(e.target.value)}
                      ref={cashReceivedRef}
                      placeholder="0.00"
                      className="flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  </div>
                  <p className="mt-2 text-[10px] font-bold uppercase text-slate-500">
                    Change due: <span className="text-slate-900">{fmt(changeDue)}</span>
                  </p>
                </div>
              )}

              <div>
                <p className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Payment</p>
                <div className="grid grid-cols-4 gap-3">
                  <button
                    type="button"
                    onClick={() => applyPaymentMode("UPI")}
                    className={`h-12 rounded-md border px-4 py-3 text-sm font-bold uppercase tracking-wider ${
                      paymentMode === "UPI" ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 text-slate-700 hover:border-emerald-600 hover:text-emerald-700"
                    }`}
                  >
                    UPI
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPaymentMode("CARD")}
                    className={`h-12 rounded-md border px-4 py-3 text-sm font-bold uppercase tracking-wider ${
                      paymentMode === "CARD" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-700 hover:border-slate-900 hover:text-slate-900"
                    }`}
                  >
                    Card
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPaymentMode("CASH")}
                    className={`h-12 rounded-md border px-4 py-3 text-sm font-bold uppercase tracking-wider ${
                      paymentMode === "CASH" ? "border-amber-500 bg-amber-500 text-white" : "border-slate-200 text-slate-700 hover:border-amber-500 hover:text-amber-700"
                    }`}
                  >
                    Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPaymentMode("SPLIT"); setPayment({ cash: "", card: "", upi: "" }); setCashReceived("") }}
                    className={`h-12 rounded-md border px-4 py-3 text-sm font-bold uppercase tracking-wider ${
                      paymentMode === "SPLIT" ? "border-slate-900 bg-white text-slate-900" : "border-slate-200 text-slate-700 hover:border-slate-900 hover:text-slate-900"
                    }`}
                  >
                    Split
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Open Tabs Drawer */}
      {showTabs && (
        <Modal title="Open Tabs" onClose={() => setShowTabs(false)}>
          {openTabs.length === 0 ? (
            <p className="text-sm text-slate-500">No open tabs.</p>
          ) : (
            <div className="space-y-3">
              {openTabs.map((tab) => (
                <div key={tab.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{tab.billNumber}</p>
                      {tab.customerName && <p className="text-xs text-slate-500">{tab.customerName}</p>}
                    </div>
                    <span className="font-bold text-emerald-600">{fmt(tab.netCollectible)}</span>
                  </div>
                  <Button
                    size="sm"
                    className="mt-2 w-full"
                    onClick={() => { setShowTabSettle(tab); setShowTabs(false) }}
                  >
                    Settle
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* Settle Tab Modal */}
      {showTabSettle && (
        <Modal title={`Settle ${showTabSettle.billNumber}`} onClose={() => setShowTabSettle(null)}>
          <p className="mb-4 text-lg font-bold text-emerald-600">{fmt(showTabSettle.netCollectible)}</p>
          <div className="space-y-3">
            {(["cash", "card", "upi"] as const).map((mode) => (
              <div key={mode} className="flex items-center gap-3">
                <label className="w-12 text-sm capitalize text-slate-600">{mode}</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={payment[mode]}
                  onChange={(e) => setPayment((p) => ({ ...p, [mode]: e.target.value }))}
                  placeholder="0.00"
                  className="flex-1 rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-3">
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => showTabSettle && handleSettleTab(showTabSettle)}
              disabled={loading}
            >
              {loading ? "Settling…" : "Settle Tab"}
            </Button>
            <Button variant="secondary" onClick={() => setShowTabSettle(null)}>Cancel</Button>
          </div>
        </Modal>
      )}

      {/* Recent Bills */}
      {showRecent && (
        <Modal title="Recent Bills" onClose={() => setShowRecent(false)}>
          {recentBills.length === 0 ? (
            <p className="text-sm text-slate-500">No recent bills.</p>
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto">
              {recentBills.map((b) => (
                <div key={b.id} className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{b.billNumber}</p>
                    <p className="text-xs text-slate-500">{b.operator.name} · {new Date(b.billedAt).toLocaleTimeString("en-IN")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">{fmt(b.netCollectible)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${b.status === "VOIDED" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                      {b.status}
                    </span>
                    {b.status === "COMMITTED" && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => { setShowVoidModal(b); setShowRecent(false) }}
                      >
                        Void
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
        <Modal title={`Void ${showVoidModal.billNumber}`} onClose={() => setShowVoidModal(null)}>
          <p className="mb-3 text-sm text-slate-600">Enter reason for voiding this bill.</p>
          <input
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="Void reason…"
            className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
          />
          <div className="mt-4 flex gap-3">
            <Button
              variant="danger"
              className="flex-1"
              onClick={() => showVoidModal && handleVoid(showVoidModal)}
              disabled={loading}
            >
              {loading ? "Voiding…" : "Confirm Void"}
            </Button>
            <Button variant="secondary" onClick={() => setShowVoidModal(null)}>Cancel</Button>
          </div>
        </Modal>
      )}

      {/* Map Barcode Modal */}
      {showMapBarcode && (
        <Modal title="Unknown Barcode" onClose={() => setShowMapBarcode(null)}>
          <p className="mb-3 text-sm text-slate-600">
            Barcode <code className="rounded bg-slate-100 px-1">{showMapBarcode.code}</code> is not mapped. Search and select the item to link it.
          </p>
          <input
            value={mapSearch}
            onChange={(e) => { setMapSearch(e.target.value); setMapTarget(null) }}
            placeholder="Search item name / barcode…"
            className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
          />
          <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-slate-200">
            {mapResults.length === 0 ? (
              <p className="px-3 py-3 text-sm text-slate-500">Type at least 2 letters to search.</p>
            ) : (
              mapResults.map((r) => (
                <button
                  key={`map-${r.kind}-${r.item.id}`}
                  onClick={() => setMapTarget(r)}
                  className={`flex w-full items-center justify-between gap-3 border-b border-slate-200 px-3 py-2 text-left hover:bg-slate-50 ${
                    mapTarget?.kind === r.kind && mapTarget.item.id === r.item.id ? "bg-emerald-50" : ""
                  }`}
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {r.kind === "LIQUOR" ? r.item.product.name : r.item.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {r.kind === "LIQUOR" ? `${r.item.sizeMl}ml · ${fmt(r.item.sellingPrice)}` : `${r.item.unit} · ${fmt(r.item.price)}`}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    r.kind === "LIQUOR" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
                  }`}>
                    {r.kind}
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="mt-4 flex gap-3">
            <Button variant="primary" className="flex-1" onClick={handleMapBarcode} disabled={!mapTarget}>
              Map Barcode
            </Button>
            <Button variant="secondary" onClick={() => setShowMapBarcode(null)}>Skip</Button>
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
