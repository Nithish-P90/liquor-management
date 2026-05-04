"use client"

import React, { useCallback, useEffect, useState } from "react"
import { Vault, Building2, TrendingUp, ArrowUpRight, ShieldCheck } from "lucide-react"

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
    },
    {
      kind: "BANK",
      title: "Transfer to Bank (direct)",
      icon: <Building2 size={18} className="text-purple-500" />,
      amountValue: toBankAmt,
      onAmountChange: setToBankAmt,
      refValue: toBankRef,
      onRefChange: setToBankRef,
    },
  ]

  return (
    <PageShell title="Galla Reconciliation" subtitle="Live cash register tracking, locker transfers, and bank settlement audit.">
      {toast && (
        <div className={`mb-8 rounded-2xl px-6 py-4 text-sm font-black uppercase tracking-widest border-2 transition-all animate-in slide-in-from-top-4 ${toast.ok ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-rose-50 border-rose-100 text-rose-800"}`}>
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
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-8">
              <MetricCard label="Opening Balance" value={fmt(galla?.openingBalance ?? 0)} color="slate" icon={Vault} />
              <MetricCard label="Accumulated (Sales)" value={fmt(cashIn)} color="emerald" icon={TrendingUp} />
              <MetricCard label="Disbursements (Out)" value={fmt(cashOut)} color="rose" icon={ArrowUpRight} />
              <MetricCard label="Live Galla Balance" value={fmt(galla?.balance ?? 0)} color="indigo" icon={Vault} subValue="Real-time Counter Cash" />
            </div>

            {/* Transfer actions */}
            {!galla?.isClosed && (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 mb-10">
                {transferCards.map((card) => (
                  <ActionCard
                    key={card.kind}
                    icon={card.icon}
                    title={card.title}
                    amountValue={card.amountValue}
                    onAmountChange={card.onAmountChange}
                    refValue={card.refValue}
                    onRefChange={card.onRefChange}
                    buttonLabel={card.kind === "LOCKER" ? "TRANSFER TO VAULT" : "SETTLE TO BANK"}
                    onSubmit={() => transfer(card.kind, card.amountValue, card.refValue)}
                    busy={busy}
                  />
                ))}
              </div>
            )}

            {/* Event log */}
            <div className="rounded-[2.5rem] border-2 border-slate-50 bg-white shadow-sm overflow-hidden">
              <div className="border-b-2 border-slate-50 px-10 py-8 bg-slate-50/50 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-black uppercase tracking-tight text-slate-900">Galla Audit Trail</h3>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mt-1">Live Transaction Stream — {today()}</p>
                </div>
              </div>
              {!galla?.events.length ? (
                <div className="py-20 text-center text-slate-400 font-black uppercase tracking-[0.2em] text-[11px]">Syncing Register Events…</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-500">
                      <tr>
                        <th className="px-10 py-5">Magnitude / Type</th>
                        <th className="px-10 py-5">Audit Identity</th>
                        <th className="px-10 py-5 text-right">NET MAGNITUDE</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y-2 divide-slate-50">
                      {galla.events.map((e) => (
                        <tr key={e.id} className="group hover:bg-slate-50 transition-colors">
                          <td className="px-10 py-6">
                            <div className="flex flex-col">
                              <span className={`text-[10px] font-black uppercase tracking-widest ${EVENT_COLOR[e.eventType] ?? "text-slate-600"}`}>
                                {EVENT_LABEL[e.eventType] ?? e.eventType}
                              </span>
                              <span className="text-[11px] font-black text-slate-400 mt-1">
                                {new Date(e.occurredAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                          </td>
                          <td className="px-10 py-6">
                            <span className="text-sm font-black text-slate-500 tracking-tight">{e.reference || "INTERNAL SYSTEM SYNC"}</span>
                          </td>
                          <td className="px-10 py-6 text-right">
                            <span className="text-lg font-black text-slate-900 tabular-nums">{fmt(e.amount)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* ── Column 2: Locker + Close Day ── */}
          <div className="space-y-6">

            {/* Locker balance */}
            <div className="rounded-[2.5rem] border-2 border-slate-900 bg-slate-900 p-10 shadow-2xl text-white overflow-hidden relative">
              <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
                <Vault size={160} />
              </div>
              
              <div className="mb-10 flex items-center gap-3">
                <div className="rounded-2xl bg-white/10 p-3 shadow-inner">
                  <Vault size={24} className="text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Financial Vault</h3>
                  <p className="text-emerald-400 text-[9px] font-black uppercase tracking-widest mt-1">Accumulated Reserves</p>
                </div>
              </div>

              <div className="mb-10">
                <p className="text-5xl font-black tracking-tighter tabular-nums">{fmt(locker?.balance ?? 0)}</p>
                <p className="mt-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Current Vault Liquidity</p>
              </div>

              <div className="space-y-4 pt-10 border-t border-white/10">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 px-1">Commit to Bank Deposit</p>
                <div className="space-y-3">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Magnitude..."
                    value={lockerDepositAmt}
                    onChange={(e) => setLockerDepositAmt(e.target.value)}
                    className="w-full rounded-2xl border-2 border-white/10 bg-white/5 px-6 py-4 text-base font-black text-white placeholder:text-slate-600 focus:border-emerald-500/50 focus:bg-white/10 focus:outline-none transition-all"
                  />
                  <input
                    type="text"
                    placeholder="Reference..."
                    value={lockerDepositRef}
                    onChange={(e) => setLockerDepositRef(e.target.value)}
                    className="w-full rounded-2xl border-2 border-white/10 bg-white/5 px-6 py-4 text-base font-black text-white placeholder:text-slate-600 focus:border-emerald-500/50 focus:bg-white/10 focus:outline-none transition-all"
                  />
                  <Button
                    variant="primary"
                    className="w-full py-5 text-[11px] font-black uppercase tracking-[0.2em] shadow-xl shadow-emerald-500/10 active:scale-95 transition-all"
                    onClick={depositLocker}
                    disabled={busy}
                  >
                    <Building2 size={18} className="mr-3" />
                    Dispatch to Bank
                  </Button>
                </div>
              </div>

              {(locker?.events.length ?? 0) > 0 && (
                <div className="mt-12 space-y-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-600">Vault Activity Log</p>
                  <div className="space-y-3">
                    {locker!.events.slice(0, 5).map((e) => (
                      <div key={e.id} className="flex justify-between items-center py-3 border-b border-white/5">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{LOCKER_EVENT_LABEL[e.eventType] ?? e.eventType}</span>
                        <span className={`text-sm font-black tabular-nums ${e.eventType === "TRANSFER_IN" ? "text-emerald-400" : "text-rose-400"}`}>
                          {e.eventType === "TRANSFER_IN" ? "+" : "−"}{fmt(e.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Day status (auto-closed by EOD cron) */}
            {galla?.isClosed && (
              <div className="rounded-[2.5rem] border-2 border-emerald-100 bg-emerald-50 p-10 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none text-emerald-900">
                  <ShieldCheck size={120} />
                </div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-600 mb-6">Operational Integrity Check</p>
                <div className="space-y-1">
                  <p className="text-4xl font-black text-emerald-800 tracking-tighter tabular-nums">{fmt(galla.countedAmount ?? 0)}</p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Terminal Closing Magnitude</p>
                </div>
                {galla.variance && Math.abs(parseFloat(galla.variance)) > 0.01 && (
                  <div className="mt-8 rounded-2xl bg-rose-50 border-2 border-rose-100 p-5">
                    <p className="text-[10px] font-black uppercase tracking-widest text-rose-400 mb-1">Discrepancy Detected</p>
                    <p className="text-xl font-black text-rose-600 tabular-nums">{fmt(galla.variance)}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </PageShell>
  )
}

function MetricCard({ label, value, color, icon: Icon, subValue }: { label: string; value: string; color: "emerald" | "indigo" | "rose" | "slate"; icon: React.ElementType; subValue?: string }): JSX.Element {
  const tones = {
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    indigo: "border-indigo-100 bg-indigo-50 text-indigo-700",
    rose: "border-rose-100 bg-rose-50 text-rose-700",
    slate: "border-slate-100 bg-slate-50 text-slate-600",
  }[color]

  return (
    <div className={`rounded-[2.5rem] border-2 p-8 shadow-sm transition-all hover:shadow-xl hover:-translate-y-1 ${tones}`}>
      <div className="flex justify-between items-start mb-6">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60">{label}</p>
        <div className="rounded-2xl bg-white/50 p-3 shadow-inner">
          <Icon size={24} />
        </div>
      </div>
      <p className="text-3xl font-black tracking-tighter tabular-nums">{value}</p>
      {subValue && <p className="mt-4 text-[10px] font-black uppercase tracking-widest opacity-60">{subValue}</p>}
    </div>
  )
}

function ActionCard({ icon, title, amountValue, onAmountChange, refValue, onRefChange, buttonLabel, onSubmit, busy }: {
  icon: React.ReactNode
  title: string
  amountValue: string
  onAmountChange: (v: string) => void
  refValue: string
  onRefChange: (v: string) => void
  buttonLabel: string
  onSubmit: () => void
  busy: boolean
}): JSX.Element {
  return (
    <div className="rounded-[2.5rem] border-2 border-slate-100 bg-white p-10 shadow-sm transition-all hover:shadow-lg">
      <div className="mb-8 flex items-center gap-4">
        <div className="rounded-2xl bg-slate-50 p-3 shadow-inner text-slate-400">
          {icon}
        </div>
        <div>
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{title}</h3>
          <p className="text-slate-400 text-[9px] font-black uppercase tracking-widest mt-1">Magnitude Dispatch</p>
        </div>
      </div>
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 px-1">Disbursement Magnitude</label>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Enter magnitude..."
            value={amountValue}
            onChange={(e) => onAmountChange(e.target.value)}
            className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-6 py-4 text-xl font-black text-slate-800 placeholder:text-slate-300 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all shadow-inner"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 px-1">Audit Reference (Optional)</label>
          <input
            type="text"
            placeholder="Define identity..."
            value={refValue}
            onChange={(e) => onRefChange(e.target.value)}
            className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-6 py-4 text-base font-black text-slate-800 placeholder:text-slate-300 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all shadow-inner"
          />
        </div>
        <Button
          onClick={onSubmit}
          disabled={busy}
          className="w-full py-5 text-[11px] font-black uppercase tracking-[0.2em] shadow-xl shadow-slate-900/10 active:scale-95 transition-all mt-4"
        >
          {buttonLabel}
        </Button>
      </div>
    </div>
  )
}
