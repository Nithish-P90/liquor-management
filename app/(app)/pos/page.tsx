"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Prisma } from "@prisma/client"

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

type CartLine = {
  key: string
  productSizeId: number
  itemName: string
  sizeMl: number
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
  const [barcodeInput, setBarcodeInput] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<ProductSizeResult[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [attribution, setAttribution] = useState<"COUNTER" | "CLERK">("COUNTER")
  const [clerks, setClerks] = useState<Array<{ id: number; name: string }>>([])
  const [selectedClerkId, setSelectedClerkId] = useState<number | undefined>()
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([])
  const [recentBills, setRecentBills] = useState<RecentBill[]>([])
  const [showTabs, setShowTabs] = useState(false)
  const [showRecent, setShowRecent] = useState(false)
  const [showPayment, setShowPayment] = useState(false)
  const [showTabSettle, setShowTabSettle] = useState<OpenTab | null>(null)
  const [showVoidModal, setShowVoidModal] = useState<RecentBill | null>(null)
  const [showMapBarcode, setShowMapBarcode] = useState<{ code: string } | null>(null)
  const [mapTarget, setMapTarget] = useState("")
  const [payment, setPayment] = useState<PaymentSplit>({ cash: "", card: "", upi: "" })
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

  // Search products
  useEffect(() => {
    if (searchQuery.trim().length < 2) { setSearchResults([]); return }
    const timer = setTimeout(() => {
      fetch(`/api/pos/search?q=${encodeURIComponent(searchQuery)}`)
        .then((r) => r.json())
        .then(setSearchResults)
        .catch(() => {})
    }, 250)
    return () => clearTimeout(timer)
  }, [searchQuery])

  function addToCart(size: ProductSizeResult): void {
    const key = `ps-${size.id}`
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key)
      if (existing) {
        return prev.map((l) => l.key === key ? { ...l, quantity: l.quantity + 1 } : l)
      }
      return [...prev, {
        key,
        productSizeId: size.id,
        itemName: `${size.product.name} ${size.sizeMl}ml`,
        sizeMl: size.sizeMl,
        quantity: 1,
        unitPrice: Number(size.sellingPrice),
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
      const size: ProductSizeResult = await res.json()
      addToCart(size)
    } else if (res.status === 404) {
      setShowMapBarcode({ code })
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
        lines: cart.map((l) => ({ productSizeId: l.productSizeId, itemNameSnapshot: l.itemName, quantity: l.quantity })),
      })
      setLoading(false)
      if (result.ok) {
        showToast(`Tab opened: ${result.data.billNumber}`, true)
        setCart([])
        setSaveAsTab(false)
        setPayment({ cash: "", card: "", upi: "" })
        setShowPayment(false)
      } else {
        showToast(result.error, false)
      }
      return
    }

    const result = await posCommit({
      attributionType: attribution,
      clerkId: selectedClerkId,
      lines: cart.map((l) => ({ productSizeId: l.productSizeId, itemNameSnapshot: l.itemName, quantity: l.quantity })),
      payments: buildPayments(),
    })
    setLoading(false)
    if (result.ok) {
      showToast(`Bill committed: ${result.data.billNumber}`, true)
      setCart([])
      setPayment({ cash: "", card: "", upi: "" })
      setShowPayment(false)
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
    const sizeId = parseInt(mapTarget, 10)
    if (!sizeId) return
    const res = await fetch("/api/pos/map-barcode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productSizeId: sizeId, barcode: showMapBarcode.code }),
    })
    if (res.ok) {
      showToast("Barcode mapped", true)
      setShowMapBarcode(null)
      setMapTarget("")
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

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${toast.ok ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.msg}
        </div>
      )}

      {/* Left panel: barcode + search + results */}
      <div className="flex w-80 flex-col border-r border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Point of Sale</h2>
          <input
            ref={barcodeRef}
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleBarcodeEnter()}
            placeholder="Scan barcode…"
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name…"
            className="mt-2 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        {/* Search results */}
        <div className="flex-1 overflow-y-auto">
          {searchResults.map((size) => (
            <button
              key={size.id}
              onClick={() => addToCart(size)}
              className="w-full border-b border-slate-800 px-4 py-3 text-left hover:bg-slate-800"
            >
              <p className="text-sm font-medium text-slate-100">{size.product.name}</p>
              <p className="text-xs text-slate-400">{size.sizeMl}ml · {fmt(size.sellingPrice)}</p>
            </button>
          ))}
        </div>

        {/* Quick-action buttons */}
        <div className="border-t border-slate-800 p-3 space-y-2">
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={() => { setShowTabs(true); refreshTabs() }}
          >
            Open Tabs
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={() => { setShowRecent(true); refreshRecent() }}
          >
            Recent Bills
          </Button>
        </div>
      </div>

      {/* Center: Cart */}
      <div className="flex flex-1 flex-col">
        {/* Attribution */}
        <div className="flex items-center gap-4 border-b border-slate-800 px-6 py-3">
          <span className="text-xs text-slate-400">Attribution</span>
          <button
            onClick={() => setAttribution("COUNTER")}
            className={`rounded-md px-3 py-1 text-xs font-medium ${attribution === "COUNTER" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}`}
          >
            Counter
          </button>
          <button
            onClick={() => setAttribution("CLERK")}
            className={`rounded-md px-3 py-1 text-xs font-medium ${attribution === "CLERK" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}`}
          >
            Clerk
          </button>
          {attribution === "CLERK" && (
            <select
              value={selectedClerkId ?? ""}
              onChange={(e) => setSelectedClerkId(e.target.value ? parseInt(e.target.value, 10) : undefined)}
              className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
            >
              <option value="">Select clerk…</option>
              {clerks.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Cart lines */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {cart.length === 0 ? (
            <p className="mt-20 text-center text-sm text-slate-500">Cart is empty. Scan or search to add items.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="pb-3">Item</th>
                  <th className="pb-3 text-center">Qty</th>
                  <th className="pb-3 text-right">Unit</th>
                  <th className="pb-3 text-right">Total</th>
                  <th className="pb-3"></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((line) => (
                  <tr key={line.key} className="border-t border-slate-800">
                    <td className="py-2 text-slate-100">{line.itemName}</td>
                    <td className="py-2">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => updateQty(line.key, -1)} className="h-6 w-6 rounded bg-slate-700 text-slate-100 hover:bg-slate-600">−</button>
                        <span className="w-8 text-center text-slate-100">{line.quantity}</span>
                        <button onClick={() => updateQty(line.key, 1)} className="h-6 w-6 rounded bg-slate-700 text-slate-100 hover:bg-slate-600">+</button>
                      </div>
                    </td>
                    <td className="py-2 text-right text-slate-300">{fmt(line.unitPrice)}</td>
                    <td className="py-2 text-right font-medium text-slate-100">{fmt(line.unitPrice * line.quantity)}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => removeFromCart(line.key)} className="text-xs text-red-400 hover:text-red-300">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Cart footer */}
        {cart.length > 0 && (
          <div className="border-t border-slate-800 px-6 py-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-lg font-semibold text-slate-100">Total</span>
              <span className="text-2xl font-bold text-emerald-400">{fmt(total)}</span>
            </div>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-400">
                <input type="checkbox" checked={saveAsTab} onChange={(e) => setSaveAsTab(e.target.checked)} />
                Save as Tab
              </label>
              <Button
                variant="primary"
                size="lg"
                className="flex-1"
                onClick={() => saveAsTab ? handleCommit() : setShowPayment(true)}
                disabled={loading}
              >
                {saveAsTab ? "Open Tab" : "Charge"}
              </Button>
              <Button variant="secondary" size="lg" onClick={() => setCart([])}>Clear</Button>
            </div>
          </div>
        )}
      </div>

      {/* Payment Modal */}
      {showPayment && !saveAsTab && (
        <Modal title="Payment" onClose={() => setShowPayment(false)}>
          <p className="mb-4 text-lg font-bold text-emerald-400">{fmt(total)}</p>
          <div className="space-y-3">
            {(["cash", "card", "upi"] as const).map((mode) => (
              <div key={mode} className="flex items-center gap-3">
                <label className="w-12 text-sm capitalize text-slate-400">{mode}</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={payment[mode]}
                  onChange={(e) => setPayment((p) => ({ ...p, [mode]: e.target.value }))}
                  placeholder="0.00"
                  className="flex-1 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            ))}
          </div>
          <p className={`mt-3 text-sm ${Math.abs(paymentSum - total) < 0.01 ? "text-emerald-400" : "text-amber-400"}`}>
            Entered: {fmt(paymentSum)} / Required: {fmt(total)}
          </p>
          <div className="mt-4 flex gap-3">
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleCommit}
              disabled={loading || Math.abs(paymentSum - total) > 0.01}
            >
              {loading ? "Processing…" : "Commit Bill"}
            </Button>
            <Button variant="secondary" onClick={() => setShowPayment(false)}>Cancel</Button>
          </div>
        </Modal>
      )}

      {/* Open Tabs Drawer */}
      {showTabs && (
        <Modal title="Open Tabs" onClose={() => setShowTabs(false)}>
          {openTabs.length === 0 ? (
            <p className="text-sm text-slate-400">No open tabs.</p>
          ) : (
            <div className="space-y-3">
              {openTabs.map((tab) => (
                <div key={tab.id} className="rounded-lg border border-slate-700 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-100">{tab.billNumber}</p>
                      {tab.customerName && <p className="text-xs text-slate-400">{tab.customerName}</p>}
                    </div>
                    <span className="font-bold text-emerald-400">{fmt(tab.netCollectible)}</span>
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
          <p className="mb-4 text-lg font-bold text-emerald-400">{fmt(showTabSettle.netCollectible)}</p>
          <div className="space-y-3">
            {(["cash", "card", "upi"] as const).map((mode) => (
              <div key={mode} className="flex items-center gap-3">
                <label className="w-12 text-sm capitalize text-slate-400">{mode}</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={payment[mode]}
                  onChange={(e) => setPayment((p) => ({ ...p, [mode]: e.target.value }))}
                  placeholder="0.00"
                  className="flex-1 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
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
            <p className="text-sm text-slate-400">No recent bills.</p>
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto">
              {recentBills.map((b) => (
                <div key={b.id} className="flex items-center justify-between rounded border border-slate-700 p-3">
                  <div>
                    <p className="text-sm font-medium text-slate-100">{b.billNumber}</p>
                    <p className="text-xs text-slate-400">{b.operator.name} · {new Date(b.billedAt).toLocaleTimeString("en-IN")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-200">{fmt(b.netCollectible)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${b.status === "VOIDED" ? "bg-red-900 text-red-300" : "bg-emerald-900 text-emerald-300"}`}>
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
          <p className="mb-3 text-sm text-slate-300">Enter reason for voiding this bill.</p>
          <input
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="Void reason…"
            className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
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
          <p className="mb-3 text-sm text-slate-300">
            Barcode <code className="rounded bg-slate-800 px-1">{showMapBarcode.code}</code> is not mapped. Enter the product size ID to link it.
          </p>
          <input
            value={mapTarget}
            onChange={(e) => setMapTarget(e.target.value)}
            placeholder="Product size ID…"
            type="number"
            className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
          />
          <div className="mt-4 flex gap-3">
            <Button variant="primary" className="flex-1" onClick={handleMapBarcode}>
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
