"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, CalendarDays, IndianRupee, Plus, ReceiptText, Sparkles, X, LayoutGrid } from "lucide-react"

import { Button } from "@/components/ui/Button"
import { PageShell } from "@/components/PageShell"

// ─── Types ──────────────────────────────────────────────────────────────────

type Category = { id: number; name: string }
type Expense = {
  id: number
  expDate: string
  particulars: string
  category: string
  categoryRef: { name: string } | null
  amount: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function today(): string { return new Date().toISOString().slice(0, 10) }

function fmt(value: number): string {
  return "₹" + value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function MetricCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  accent: "red" | "slate" | "emerald" | "indigo"
}): JSX.Element {
  const tone = {
    red: "from-red-50 to-white text-red-600 border-red-100",
    slate: "from-slate-50 to-white text-slate-700 border-slate-200",
    emerald: "from-emerald-50 to-white text-emerald-600 border-emerald-100",
    indigo: "from-indigo-50 to-white text-indigo-600 border-indigo-100",
  }[accent]

  return (
    <div className={`rounded-2xl border-2 bg-gradient-to-br p-5 shadow-sm transition-all hover:shadow-md ${tone}`}>
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-white/80 shadow-inner">
        {icon}
      </div>
      <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 text-3xl font-black text-slate-900 tracking-tight">{value}</p>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 block px-1">{label}</label>
      {children}
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ExpensesPage(): JSX.Element {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ expDate: today(), particulars: "", categoryId: "", amount: "" })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const showToast = useCallback((msg: string, ok: boolean) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }, [])

  // ── Stats Calculations ─────────────────────────────────────────────────────
  const total = useMemo(() => expenses.reduce((sum, e) => sum + Number(e.amount), 0), [expenses])
  const average = useMemo(() => (expenses.length > 0 ? total / expenses.length : 0), [expenses, total])
  const latestDate = useMemo(() => {
    if (expenses.length === 0) return null
    return [...expenses].sort((a, b) => b.expDate.localeCompare(a.expDate))[0]?.expDate.slice(0, 10) ?? null
  }, [expenses])

  // ── Data Fetching ─────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [expRes, catRes] = await Promise.all([
        fetch(`/api/expenses?from=${from}&to=${to}`),
        fetch("/api/expense-categories"),
      ])
      if (expRes.ok) setExpenses(await expRes.json())
      if (catRes.ok) setCategories(await catRes.json())
    } catch {
      showToast("Failed to sync expenses", false)
    } finally {
      setLoading(false)
    }
  }, [from, to, showToast])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleAdd(): Promise<void> {
    if (!form.particulars.trim() || !form.categoryId || !form.amount) {
      showToast("Please fill all required fields", false)
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          amount: parseFloat(form.amount),
          categoryId: parseInt(form.categoryId),
        }),
      })
      if (res.ok) {
        showToast("Expense recorded successfully", true)
        setForm({ expDate: today(), particulars: "", categoryId: "", amount: "" })
        setShowAdd(false)
        void fetchAll()
      } else {
        const err = await res.json()
        showToast(err.error ?? "Failed to save expense", false)
      }
    } catch {
      showToast("Network error occurred", false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageShell title="Expenses & Payouts" subtitle="Record and audit daily business expenditures and overheads.">
      <div className="space-y-10">
        {toast && (
          <div className={`rounded-xl border-2 px-6 py-4 text-sm font-bold animate-in fade-in slide-in-from-top-2 ${toast.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
            {toast.msg}
          </div>
        )}

        {/* ── Metric Grid ── */}
        <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={<IndianRupee size={22} />} label="Total Expenditure" value={fmt(total)} accent="red" />
          <MetricCard icon={<ReceiptText size={22} />} label="Voucher Count" value={String(expenses.length)} accent="slate" />
          <MetricCard icon={<Sparkles size={22} />} label="Daily Average" value={fmt(average)} accent="emerald" />
          <MetricCard icon={<CalendarDays size={22} />} label="Latest Voucher" value={latestDate ?? "—"} accent="indigo" />
        </section>

        <section className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_380px] items-start">
          <div className="space-y-8">
            {/* ── Filters ── */}
            <div className="rounded-2xl border-2 border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-end gap-6">
                <div className="flex-1 min-w-[200px]">
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-3">Audit Date Range</p>
                  <div className="flex items-center gap-3">
                    <div className="flex flex-1 items-center gap-3 rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 transition-colors focus-within:border-indigo-400 focus-within:bg-white">
                      <CalendarDays size={18} className="text-slate-400" />
                      <input
                        type="date"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                        className="w-full bg-transparent text-base font-bold text-slate-800 focus:outline-none"
                      />
                    </div>
                    <div className="h-px w-4 bg-slate-200" />
                    <div className="flex flex-1 items-center gap-3 rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 transition-colors focus-within:border-indigo-400 focus-within:bg-white">
                      <CalendarDays size={18} className="text-slate-400" />
                      <input
                        type="date"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        className="w-full bg-transparent text-base font-bold text-slate-800 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
                <Button 
                  onClick={() => setShowAdd((open) => !open)}
                  variant={showAdd ? "secondary" : "primary"}
                  className="rounded-2xl px-8 py-4 text-sm font-black uppercase tracking-widest shadow-lg active:scale-95 transition-all"
                >
                  {showAdd ? <X size={20} className="mr-2" /> : <Plus size={20} className="mr-2" />}
                  {showAdd ? "Close Form" : "New Entry"}
                </Button>
              </div>
            </div>

            {/* ── Ledger Table ── */}
            <div className="rounded-2xl border-2 border-slate-100 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b-2 border-slate-50 px-6 py-5 bg-slate-50/50">
                <div>
                  <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">Expense Ledger</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Transaction Audit Trail</p>
                </div>
                <button onClick={fetchAll} className="p-2 text-slate-400 hover:text-slate-900 transition-colors">
                  <LayoutGrid size={20} />
                </button>
              </div>

              {loading ? (
                <div className="px-6 py-16 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 mx-auto" />
                  <p className="mt-4 text-sm font-bold text-slate-400 uppercase tracking-widest">Syncing with ledger…</p>
                </div>
              ) : expenses.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <AlertCircle className="mx-auto mb-4 text-slate-200" size={48} />
                  <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">No transactions found for this range</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 text-[11px] font-black uppercase tracking-widest text-slate-500">
                      <tr className="text-left">
                        <th className="px-6 py-4">Date</th>
                        <th className="px-6 py-4">Particulars</th>
                        <th className="px-6 py-4">Category</th>
                        <th className="px-6 py-4 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y-2 divide-slate-50">
                      {expenses.map((e) => (
                        <tr key={e.id} className="group hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-5 font-bold text-slate-500 whitespace-nowrap">{e.expDate.slice(0, 10)}</td>
                          <td className="px-6 py-5 font-bold text-slate-900">{e.particulars}</td>
                          <td className="px-6 py-5">
                            <span className="rounded-full border-2 border-slate-100 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">{e.categoryRef?.name ?? e.category}</span>
                          </td>
                          <td className="px-6 py-5 text-right font-black text-lg text-rose-600">{fmt(Number(e.amount))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* ── Entry Sidebar ── */}
          <aside className="sticky top-6">
            <div className={`rounded-2xl border-2 bg-white p-6 shadow-xl transition-all duration-300 ${showAdd ? "border-slate-900 opacity-100" : "border-slate-100 opacity-80"}`}>
              <div className="mb-8">
                <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Record Expense</h3>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Instant Voucher Entry</p>
              </div>

              {showAdd ? (
                <div className="space-y-6">
                  <Field label="Voucher Date">
                    <input
                      type="date"
                      value={form.expDate}
                      onChange={(e) => setForm((f) => ({ ...f, expDate: e.target.value }))}
                      className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3.5 text-base font-bold text-slate-800 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all"
                    />
                  </Field>

                  <Field label="Expenditure Category">
                    <select
                      value={form.categoryId}
                      onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                      className="w-full appearance-none rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3.5 text-base font-bold text-slate-800 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all"
                    >
                      <option value="">Select Category…</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>

                  <Field label="Particulars / Description">
                    <input
                      type="text"
                      value={form.particulars}
                      onChange={(e) => setForm((f) => ({ ...f, particulars: e.target.value }))}
                      placeholder="What was this for?"
                      className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3.5 text-base font-bold text-slate-800 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all"
                    />
                  </Field>

                  <Field label="Total Amount (₹)">
                    <div className="relative">
                      <IndianRupee size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.amount}
                        onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                        className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-12 py-3.5 text-xl font-black text-rose-600 focus:border-rose-400 focus:bg-white focus:outline-none transition-all"
                        placeholder="0.00"
                      />
                    </div>
                  </Field>

                  <div className="pt-4 space-y-3">
                    <Button 
                      className="w-full py-5 text-sm font-black uppercase tracking-[0.2em] shadow-emerald-900/10" 
                      onClick={handleAdd}
                      disabled={saving}
                    >
                      {saving ? "Processing…" : "Confirm Voucher"}
                    </Button>
                    <Button variant="secondary" className="w-full py-4 text-xs font-bold uppercase tracking-widest" onClick={() => setShowAdd(false)}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center">
                  <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-50 text-slate-300">
                    <Plus size={32} />
                  </div>
                  <p className="text-sm font-bold text-slate-400 uppercase leading-relaxed px-6">
                    Ready to record a new business expense? Click the button above to start.
                  </p>
                </div>
              )}
            </div>
          </aside>
        </section>
      </div>
    </PageShell>
  )
}
