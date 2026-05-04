"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { AlertCircle, CalendarDays, IndianRupee, Plus, ReceiptText, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/Button"
import { PageShell } from "@/components/PageShell"

type Category = { id: number; name: string }
type Expense = {
  id: number
  expDate: string
  particulars: string
  category: string
  categoryRef: { name: string } | null
  amount: string
}

function today(): string { return new Date().toISOString().slice(0, 10) }

function fmt(value: number): string {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function ExpensesPage(): JSX.Element {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ expDate: today(), particulars: "", categoryId: "", amount: "" })
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok: boolean): void {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchAll = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [expRes, catRes] = await Promise.all([
        fetch(`/api/expenses?from=${from}&to=${to}`),
        fetch("/api/expense-categories"),
      ])
          const average = expenses.length > 0 ? total / expenses.length : 0
          const latestDate = useMemo(() => {
            if (expenses.length === 0) return null
            return [...expenses].sort((a, b) => b.expDate.localeCompare(a.expDate))[0]?.expDate ?? null
          }, [expenses])
      setExpenses(await expRes.json())
      setCategories(await catRes.json())
            <PageShell title="Expenses" subtitle="Record and review daily expenditures.">
              <div className="space-y-6">
                {toast && (
                  <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${toast.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
                    {toast.msg}
                  </div>
                )}

                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <MetricCard icon={<IndianRupee size={18} />} label="Total spent" value={fmt(total)} accent="red" />
                  <MetricCard icon={<ReceiptText size={18} />} label="Expense count" value={String(expenses.length)} accent="slate" />
                  <MetricCard icon={<Sparkles size={18} />} label="Average" value={fmt(average)} accent="emerald" />
                  <MetricCard icon={<CalendarDays size={18} />} label="Latest entry" value={latestDate ?? "—"} accent="indigo" />
                </section>

                <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
                  <div className="space-y-6">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-end gap-4">
                        <div className="grid gap-1">
                          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Date range</span>
                          <p className="text-sm text-slate-500">Filter the expense ledger by business date.</p>
                        </div>
                        <div className="ml-auto flex flex-wrap items-center gap-3">
                          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">From</label>
                            <input
                              type="date"
                              value={from}
                              onChange={(e) => setFrom(e.target.value)}
                              className="bg-transparent text-sm font-semibold text-slate-800 focus:outline-none"
                            />
                          </div>
                          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">To</label>
                            <input
                              type="date"
                              value={to}
                              onChange={(e) => setTo(e.target.value)}
                              className="bg-transparent text-sm font-semibold text-slate-800 focus:outline-none"
                            />
                          </div>
                          <Button onClick={() => setShowAdd((open) => !open)}>
                            <Plus size={14} className="mr-1.5" />
                            {showAdd ? "Hide form" : "Add expense"}
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">Expense Ledger</h3>
                          <p className="text-xs text-slate-500">All entries for the selected date window.</p>
                        </div>
                        {loading && <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Loading…</span>}
                      </div>

                      {loading ? (
                        <p className="px-5 py-10 text-sm text-slate-500">Loading…</p>
                      ) : expenses.length === 0 ? (
                        <div className="px-5 py-10 text-center text-sm text-slate-500">
                          <AlertCircle className="mx-auto mb-2 text-slate-300" size={24} />
                          No expenses for this period.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="min-w-[720px] w-full text-sm">
                            <thead className="bg-slate-50">
                              <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                                <th className="px-5 py-3">Date</th>
                                <th className="px-5 py-3">Particulars</th>
                                <th className="px-5 py-3">Category</th>
                                <th className="px-5 py-3 text-right">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {expenses.map((e) => (
                                <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                                  <td className="px-5 py-4 whitespace-nowrap text-slate-500">{e.expDate.slice(0, 10)}</td>
                                  <td className="px-5 py-4 text-slate-800">{e.particulars}</td>
                                  <td className="px-5 py-4 whitespace-nowrap text-slate-500">{e.categoryRef?.name ?? e.category}</td>
                                  <td className="px-5 py-4 text-right font-semibold text-red-600">{fmt(Number(e.amount))}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>

                  <aside className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">New Expense</h3>
                          <p className="text-xs text-slate-500">Quick entry form for daily spending.</p>
                        </div>
                      </div>

                      {showAdd ? (
                        <div className="mt-5 space-y-4">
                          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                            <Field label="Date">
                              <input
                                type="date"
                                value={form.expDate}
                                onChange={(e) => setForm((f) => ({ ...f, expDate: e.target.value }))}
                                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none"
                              />
                            </Field>
                            <Field label="Category">
                              <select
                                value={form.categoryId}
                                onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none"
                              >
                                <option value="">Select category</option>
                                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </select>
                            </Field>
                          </div>

                          <Field label="Particulars">
                            <input
                              type="text"
                              value={form.particulars}
                              onChange={(e) => setForm((f) => ({ ...f, particulars: e.target.value }))}
                              placeholder="Description"
                              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none"
                            />
                          </Field>

                          <Field label="Amount (₹)">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={form.amount}
                              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none"
                            />
                          </Field>

                          <div className="flex gap-3">
                            <Button className="flex-1" onClick={handleAdd}>Save expense</Button>
                            <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-5 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                          Open the form to record a new expense without leaving the page.
                        </div>
                      )}
                    </div>
                  </aside>
                </section>
              </div>
        <span className="text-xs text-slate-400">Total: </span>
        <span className="text-lg font-bold text-red-400">₹{total.toFixed(2)}</span>
      </div>

        function MetricCard({
          icon,
          label,
          value,
          accent,
        }: {
          icon: JSX.Element
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
            <div className={`rounded-2xl border bg-gradient-to-br p-4 shadow-sm ${tone}`}>
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-white/80">
                {icon}
              </div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
              <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
            </div>
          )
        }

        function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
          return (
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</span>
              {children}
            </label>
          )
        }

      {loading ? <p className="text-sm text-slate-400">Loading…</p> : expenses.length === 0 ? (
        <p className="text-sm text-slate-400">No expenses for this period.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60">
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Particulars</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                  <td className="px-4 py-3 text-slate-400">{e.expDate.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-slate-200">{e.particulars}</td>
                  <td className="px-4 py-3 text-slate-400">{e.categoryRef?.name ?? e.category}</td>
                  <td className="px-4 py-3 text-right font-medium text-red-400">₹{Number(e.amount).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  )
}
