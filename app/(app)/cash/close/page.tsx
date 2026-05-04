"use client"

import { useCallback, useEffect, useState } from "react"
import { Vault, Building2 } from "lucide-react"

import { Button } from "@/components/ui/Button"
import { PageShell } from "@/components/PageShell"

type GallaEvent = {
  id: number
  eventType: string
  amount: string
  reference: string | null
  occurredAt: string
}

type GallaDay = {
  id: number
  businessDate: string
  openingBalance: string
  isClosed: boolean
  closingBalance?: string
  countedAmount?: string
  variance?: string
  balance: string
  events: GallaEvent[]
}

type LockerData = {
  id: number
  balance: string
  events: Array<{
    id: number
    eventType: string
    amount: string
    reference: string | null
    occurredAt: string
  }>
}

type TransferKind = "LOCKER" | "BANK"

type TransferCardConfig = {
  kind: TransferKind
  title: string
  icon: JSX.Element
  amountValue: string
  onAmountChange: (value: string) => void
  refValue: string
  onRefChange: (value: string) => void
  accentColor: "blue" | "purple"
}

const EVENT_LABEL: Record<string, string> = {
  SALE_CASH: "Cash Sale",
  REFUND_CASH: "Refund",
  EXPENSE: "Expense",
  TRANSFER_TO_LOCKER: "→ Locker",
  TRANSFER_TO_BANK: "→ Bank",
  OPENING_BALANCE: "Opening",
}

const EVENT_COLOR: Record<string, string> = {
  SALE_CASH: "text-emerald-600",
  REFUND_CASH: "text-red-500",
  EXPENSE: "text-amber-500",
  TRANSFER_TO_LOCKER: "text-blue-500",
  TRANSFER_TO_BANK: "text-purple-500",
  OPENING_BALANCE: "text-slate-400",
}

const LOCKER_EVENT_LABEL: Record<string, string> = {
  TRANSFER_IN: "From Register",
  TRANSFER_OUT: "Transfer Out",
  DEPOSIT_TO_BANK: "→ Bank",
}

function fmt(v: string | number): string {
  return "₹" + Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function summarizeCashEvents(events: GallaEvent[] | undefined): { cashIn: number; cashOut: number } {
  let cashIn = 0
  let cashOut = 0

  for (const event of events ?? []) {
    const amount = Number(event.amount)

    if (event.eventType === "SALE_CASH") {
      cashIn += amount
      continue
    }

    if (["REFUND_CASH", "EXPENSE", "TRANSFER_TO_LOCKER", "TRANSFER_TO_BANK"].includes(event.eventType)) {
      cashOut += amount
    }
  }

  return { cashIn, cashOut }
}

function normalizeGallaDay(gallaData: GallaDay | { date: string; balance: string; events: GallaEvent[]; isClosed: boolean }): GallaDay {
  if ("id" in gallaData) {
    return gallaData
  }

  return {
    id: 0,
    businessDate: today(),
    openingBalance: "0",
    isClosed: false,
    balance: gallaData.balance,
    events: gallaData.events ?? [],
  }
}

export default function CashManagementPage(): JSX.Element {
  const [galla, setGalla] = useState<GallaDay | null>(null)
  const [locker, setLocker] = useState<LockerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  // transfer state
  const [toLockerAmt, setToLockerAmt] = useState("")
  const [toLockerRef, setToLockerRef] = useState("")
  const [toBankAmt, setToBankAmt] = useState("")
  const [toBankRef, setToBankRef] = useState("")
  const [lockerDepositAmt, setLockerDepositAmt] = useState("")
  const [lockerDepositRef, setLockerDepositRef] = useState("")

  const [busy, setBusy] = useState(false)

  function showToast(msg: string, ok: boolean): void {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [gallaRes, lockerRes] = await Promise.all([
        fetch(`/api/galla?date=${today()}`, { cache: "no-store" }),
        fetch("/api/locker", { cache: "no-store" }),
      ])
      const gallaData = await gallaRes.json() as GallaDay | { date: string; balance: string; events: GallaEvent[]; isClosed: boolean }
      setGalla(normalizeGallaDay(gallaData))
      if (lockerRes.ok) setLocker(await lockerRes.json() as LockerData)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function transfer(type: "LOCKER" | "BANK", amount: string, reference: string): Promise<void> {
    if (!amount || Number(amount) <= 0) { showToast("Enter a valid amount", false); return }
    setBusy(true)
    const res = await fetch("/api/galla/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, amount: parseFloat(amount), reference: reference || undefined }),
    })
    setBusy(false)
    if (res.ok) {
      showToast(type === "LOCKER" ? "Transferred to locker" : "Transferred to bank", true)
      if (type === "LOCKER") { setToLockerAmt(""); setToLockerRef("") }
      else { setToBankAmt(""); setToBankRef("") }
      void refresh()
    } else {
      const err = await res.json() as { error?: string }
      showToast(err.error ?? "Transfer failed", false)
    }
  }

  async function depositLocker(): Promise<void> {
    if (!lockerDepositAmt || Number(lockerDepositAmt) <= 0) { showToast("Enter a valid amount", false); return }
    setBusy(true)
    const res = await fetch("/api/locker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: parseFloat(lockerDepositAmt), reference: lockerDepositRef || undefined }),
    })
    setBusy(false)
    if (res.ok) {
      showToast("Deposited to bank", true)
      setLockerDepositAmt(""); setLockerDepositRef("")
      void refresh()
    } else {
      const err = await res.json() as { error?: string }
      showToast(err.error ?? "Deposit failed", false)
    }
  }

  // Compute summary figures from events
  const { cashIn, cashOut } = summarizeCashEvents(galla?.events)

  const transferCards: TransferCardConfig[] = [
    {
      kind: "LOCKER",
      title: "Transfer to Locker",
      icon: <Vault size={18} className="text-blue-500" />,
      amountValue: toLockerAmt,
      onAmountChange: setToLockerAmt,
      refValue: toLockerRef,
      onRefChange: setToLockerRef,
      accentColor: "blue",
    },
    {
      kind: "BANK",
      title: "Transfer to Bank (direct)",
      icon: <Building2 size={18} className="text-purple-500" />,
      amountValue: toBankAmt,
      onAmountChange: setToBankAmt,
      refValue: toBankRef,
      onRefChange: setToBankRef,
      accentColor: "purple",
    },
  ]

  return (
    <PageShell title="Cash Management" subtitle={`Register · Locker · Bank — ${today()}`}>
      {toast && (
        <div className={`mb-5 rounded-lg px-4 py-3 text-sm font-semibold ${toast.ok ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "bg-red-50 border border-red-200 text-red-800"}`}>
          {toast.msg}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">

          {/* ── Column 1: Cash Register ── */}
          <div className="lg:col-span-2 space-y-6">

            {/* Balance bar */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Card label="Opening" value={fmt(galla?.openingBalance ?? 0)} />
              <Card label="Cash In (sales)" value={fmt(cashIn)} green />
              <Card label="Cash Out" value={fmt(cashOut)} red />
              <Card label="Register Balance" value={fmt(galla?.balance ?? 0)} big />
            </div>

            {/* Transfer actions */}
            {!galla?.isClosed && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {transferCards.map((card) => (
                  <ActionCard
                    key={card.kind}
                    icon={card.icon}
                    title={card.title}
                    amountValue={card.amountValue}
                    onAmountChange={card.onAmountChange}
                    refValue={card.refValue}
                    onRefChange={card.onRefChange}
                    buttonLabel="Transfer"
                    onSubmit={() => transfer(card.kind, card.amountValue, card.refValue)}
                    busy={busy}
                    accentColor={card.accentColor}
                  />
                ))}
              </div>
            )}

            {/* Event log */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <h3 className="text-sm font-bold text-slate-800">Register Events — {today()}</h3>
              </div>
              {!galla?.events.length ? (
                <p className="px-5 py-8 text-sm text-slate-400 text-center">No events yet today</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {galla.events.map((e) => (
                    <div key={e.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className={`text-sm font-semibold ${EVENT_COLOR[e.eventType] ?? "text-slate-600"}`}>
                          {EVENT_LABEL[e.eventType] ?? e.eventType}
                        </p>
                        <p className="text-xs text-slate-400">
                          {new Date(e.occurredAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                          {e.reference ? ` · ${e.reference}` : ""}
                        </p>
                      </div>
                      <p className="font-mono text-sm font-bold text-slate-800">{fmt(e.amount)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Column 2: Locker + Close Day ── */}
          <div className="space-y-6">

            {/* Locker balance */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Vault size={18} className="text-blue-500" />
                <h3 className="text-sm font-bold text-slate-800">Locker</h3>
              </div>
              <p className="text-3xl font-black text-slate-900">{fmt(locker?.balance ?? 0)}</p>
              <p className="mt-1 text-xs text-slate-400">accumulated balance</p>

              <div className="mt-5 space-y-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Amount to deposit to bank"
                  value={lockerDepositAmt}
                  onChange={(e) => setLockerDepositAmt(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                />
                <input
                  type="text"
                  placeholder="Reference (optional)"
                  value={lockerDepositRef}
                  onChange={(e) => setLockerDepositRef(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                />
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={depositLocker}
                  disabled={busy}
                >
                  <Building2 size={14} className="mr-1.5 inline" />
                  Deposit to Bank
                </Button>
              </div>

              {(locker?.events.length ?? 0) > 0 && (
                <div className="mt-4 space-y-1">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Recent</p>
                  {locker!.events.slice(0, 6).map((e) => (
                    <div key={e.id} className="flex justify-between text-xs">
                      <span className="text-slate-500">{LOCKER_EVENT_LABEL[e.eventType] ?? e.eventType}</span>
                      <span className={`font-mono font-semibold ${e.eventType === "TRANSFER_IN" ? "text-emerald-600" : "text-red-500"}`}>
                        {e.eventType === "TRANSFER_IN" ? "+" : "−"}{fmt(e.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Day status (auto-closed by EOD cron) */}
            {galla?.isClosed && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Day Closed</p>
                <p className="mt-1 text-2xl font-black text-slate-800">{fmt(galla.countedAmount ?? 0)}</p>
                <p className="text-xs text-slate-500">closing balance</p>
                {galla.variance && Math.abs(parseFloat(galla.variance)) > 0.01 && (
                  <p className="mt-2 text-xs font-semibold text-red-600">
                    Variance: {fmt(galla.variance)}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </PageShell>
  )
}

function Card({ label, value, green, red, big }: {
  label: string; value: string; green?: boolean; red?: boolean; big?: boolean
}): JSX.Element {
  return (
    <div className={`rounded-xl border p-4 ${big ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"}`}>
      <p className={`text-[10px] font-bold uppercase tracking-wider ${big ? "text-slate-400" : "text-slate-400"}`}>{label}</p>
      <p className={`mt-1 text-xl font-black ${big ? "text-white" : green ? "text-emerald-600" : red ? "text-red-500" : "text-slate-800"}`}>
        {value}
      </p>
    </div>
  )
}

function ActionCard({ icon, title, amountValue, onAmountChange, refValue, onRefChange, buttonLabel, onSubmit, busy, accentColor }: {
  icon: React.ReactNode
  title: string
  amountValue: string
  onAmountChange: (v: string) => void
  refValue: string
  onRefChange: (v: string) => void
  buttonLabel: string
  onSubmit: () => void
  busy: boolean
  accentColor: "blue" | "purple"
}): JSX.Element {
  const borderClass = accentColor === "blue" ? "border-blue-200 focus:border-blue-400" : "border-purple-200 focus:border-purple-400"
  const btnBg = accentColor === "blue" ? "bg-blue-600 hover:bg-blue-700" : "bg-purple-600 hover:bg-purple-700"

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <p className="text-sm font-bold text-slate-800">{title}</p>
      </div>
      <div className="space-y-2">
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="Amount…"
          value={amountValue}
          onChange={(e) => onAmountChange(e.target.value)}
          className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${borderClass}`}
        />
        <input
          type="text"
          placeholder="Reference (optional)"
          value={refValue}
          onChange={(e) => onRefChange(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-slate-400"
        />
        <button
          onClick={onSubmit}
          disabled={busy}
          className={`w-full rounded-lg px-3 py-2 text-sm font-bold text-white transition disabled:opacity-50 ${btnBg}`}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  )
}
