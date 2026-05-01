"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/Button"
import { PageShell } from "@/components/PageShell"

type GallaDay = {
  id: number
  businessDate: string
  openingBalance: string
  isClosed: boolean
  closingBalance?: string
  countedAmount?: string
  variance?: string
  balance: string
  events: Array<{
    id: number
    eventType: string
    amount: string
    reference: string | null
    occurredAt: string
  }>
}

const EVENT_COLORS: Record<string, string> = {
  SALE_CASH: "text-emerald-400",
  SALE_CARD: "text-blue-400",
  SALE_UPI: "text-purple-400",
  REFUND_CASH: "text-red-400",
  EXPENSE: "text-amber-400",
  TRANSFER_TO_LOCKER: "text-slate-400",
}

export default function CashClosePage(): JSX.Element {
  const [gallaDay, setGallaDay] = useState<GallaDay | null>(null)
  const [loading, setLoading] = useState(true)
  const [countedAmount, setCountedAmount] = useState("")
  const [closing, setClosing] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok: boolean): void {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  async function fetchGalla(): Promise<void> {
    setLoading(true)
    try {
      const res = await fetch("/api/galla")
      setGallaDay(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchGalla() }, [])

  async function handleClose(): Promise<void> {
    if (!countedAmount) { showToast("Enter counted amount", false); return }
    setClosing(true)
    const res = await fetch("/api/galla/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ countedAmount: parseFloat(countedAmount) }),
    })
    setClosing(false)

    if (res.ok) {
      const data = await res.json()
      const v = parseFloat(data.variance)
      showToast(`Day closed. Variance: ₹${v.toFixed(2)}`, v === 0)
      fetchGalla()
    } else {
      const err = await res.json()
      showToast(err.error ?? "Close failed", false)
    }
  }

  return (
    <PageShell title="Cash Close" subtitle="Review today's cash events and close the galla.">
      {toast && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium ${toast.ok ? "bg-emerald-900/50 text-emerald-300" : "bg-red-900/50 text-red-300"}`}>
          {toast.msg}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : !gallaDay ? (
        <p className="text-sm text-slate-400">No galla data for today.</p>
      ) : (
        <div className="grid grid-cols-3 gap-6">
          {/* Summary */}
          <div className="col-span-2 space-y-4">
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Opening Balance", value: `₹${parseFloat(gallaDay.openingBalance).toFixed(2)}` },
                { label: "Computed Balance", value: `₹${parseFloat(gallaDay.balance).toFixed(2)}` },
                gallaDay.isClosed
                  ? { label: "Variance", value: `₹${parseFloat(gallaDay.variance ?? "0").toFixed(2)}`, highlight: parseFloat(gallaDay.variance ?? "0") !== 0 }
                  : { label: "Status", value: "Open" },
              ].map((card) => (
                <div key={card.label} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                  <p className="text-xs text-slate-400">{card.label}</p>
                  <p className={`mt-1 text-xl font-bold ${"highlight" in card && card.highlight ? "text-red-400" : "text-slate-100"}`}>
                    {card.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Events */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60">
              <div className="border-b border-slate-800 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-200">Today&apos;s Events</h3>
              </div>
              {gallaDay.events.length === 0 ? (
                <p className="px-4 py-6 text-sm text-slate-500">No events recorded yet.</p>
              ) : (
                <div className="divide-y divide-slate-800">
                  {gallaDay.events.map((event) => (
                    <div key={event.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className={`text-sm font-medium ${EVENT_COLORS[event.eventType] ?? "text-slate-300"}`}>
                          {event.eventType.replace(/_/g, " ")}
                        </p>
                        {event.reference && <p className="text-xs text-slate-500">{event.reference}</p>}
                      </div>
                      <p className="font-medium text-slate-200">₹{parseFloat(event.amount).toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Close panel */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <h3 className="mb-4 text-sm font-semibold text-slate-200">Close Day</h3>
            {gallaDay.isClosed ? (
              <div className="rounded-lg border border-emerald-800 bg-emerald-900/20 p-4 text-center">
                <p className="text-sm text-emerald-300">Day closed</p>
                <p className="mt-1 text-2xl font-bold text-slate-100">₹{parseFloat(gallaDay.countedAmount ?? "0").toFixed(2)}</p>
                <p className="mt-1 text-xs text-slate-400">counted</p>
              </div>
            ) : (
              <>
                <p className="mb-3 text-xs text-slate-400">Enter the physical cash count before closing.</p>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={countedAmount}
                  onChange={(e) => setCountedAmount(e.target.value)}
                  placeholder="Counted amount…"
                  className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
                <Button
                  variant="primary"
                  className="mt-4 w-full"
                  onClick={handleClose}
                  disabled={closing}
                >
                  {closing ? "Closing…" : "Close Day"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </PageShell>
  )
}
