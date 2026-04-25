"use client"

import { useEffect, useState } from "react"

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

  async function fetchAll(): Promise<void> {
    setLoading(true)
    try {
      const [expRes, catRes] = await Promise.all([
        fetch(`/api/expenses?from=${from}&to=${to}`),
        fetch("/api/expense-categories"),
      ])
      setExpenses(await expRes.json())
      setCategories(await catRes.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [from, to])

  async function handleAdd(): Promise<void> {
    const res = await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expDate: form.expDate,
        particulars: form.particulars,
        categoryId: form.categoryId ? parseInt(form.categoryId, 10) : undefined,
        amount: parseFloat(form.amount),
      }),
    })

    if (res.ok) {
      showToast("Expense recorded", true)
      setShowAdd(false)
      setForm({ expDate: today(), particulars: "", categoryId: "", amount: "" })
      fetchAll()
    } else {
      const err = await res.json()
      showToast(err.error ?? "Failed", false)
    }
  }

  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0)

  return (
    <PageShell title="Expenses" subtitle="Record and review daily expenditures.">
      {toast && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium ${toast.ok ? "bg-emerald-900/50 text-emerald-300" : "bg-red-900/50 text-red-300"}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-4">
        {["from", "to"].map((field) => (
          <div key={field} className="flex items-center gap-2">
            <label className="text-xs text-slate-400 capitalize">{field}</label>
            <input
              type="date"
              value={field === "from" ? from : to}
              onChange={(e) => field === "from" ? setFrom(e.target.value) : setTo(e.target.value)}
              className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        ))}
        <Button className="ml-auto" onClick={() => setShowAdd(true)}>Add Expense</Button>
      </div>

      {showAdd && (
        <div className="mb-6 rounded-lg border border-slate-700 bg-slate-800/50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-200">New Expense</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Date</label>
              <input type="date" value={form.expDate} onChange={(e) => setForm((f) => ({ ...f, expDate: e.target.value }))}
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Category</label>
              <select value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none">
                <option value="">Select…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-slate-400">Particulars</label>
              <input type="text" value={form.particulars} onChange={(e) => setForm((f) => ({ ...f, particulars: e.target.value }))}
                placeholder="Description…"
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Amount (₹)</label>
              <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none" />
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <Button onClick={handleAdd}>Save</Button>
            <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-right">
        <span className="text-xs text-slate-400">Total: </span>
        <span className="text-lg font-bold text-red-400">₹{total.toFixed(2)}</span>
      </div>

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
