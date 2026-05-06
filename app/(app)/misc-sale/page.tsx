"use client"

import { useState, useEffect, useCallback, useMemo, ReactNode } from "react"

import { CalendarDays, LayoutGrid } from "lucide-react"

import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"

const MISC_CATEGORIES = ["CIGARETTES", "SNACKS", "CUPS"] as const

type MiscItemResult = {
  id: number
  name: string
  unit: string
  price: string
  category: (typeof MISC_CATEGORIES)[number]
  barcode: string | null
  active: boolean
  isThirdParty: boolean
}

type MiscSalesMetrics = {
  from: string
  to: string
  billCount: number
  quantity: number
  grossRevenue: number
  ownerRevenue: number
  thirdPartyRevenue: number
  items: Array<{
    miscItemId: number | null
    itemName: string
    category: string
    unit: string
    quantity: number
    grossRevenue: number
    ownerRevenue: number
    thirdPartyRevenue: number
  }>
}

type MiscItemFormState = {
  id: number | null
  name: string
  category: (typeof MISC_CATEGORIES)[number]
  unit: string
  price: string
  barcode: string
  active: boolean
  isThirdParty: boolean
}

function fmt(v: string | number): string {
  return "₹" + Number(v).toFixed(2)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function blankForm(): MiscItemFormState {
  return {
    id: null,
    name: "",
    category: "CIGARETTES",
    unit: "pcs",
    price: "0",
    barcode: "",
    active: true,
    isThirdParty: false,
  }
}

export default function Page(): JSX.Element {
  const [items, setItems] = useState<MiscItemResult[]>([])
  const [metrics, setMetrics] = useState<MiscSalesMetrics | null>(null)
  const [loadingItems, setLoadingItems] = useState(false)
  const [loadingMetrics, setLoadingMetrics] = useState(false)
  const [itemError, setItemError] = useState<string | null>(null)
  const [metricsError, setMetricsError] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [category, setCategory] = useState("ALL")
  const [showInactive, setShowInactive] = useState(false)
  const [from, setFrom] = useState(daysAgo(6))
  const [to, setTo] = useState(today())
  const [form, setForm] = useState<MiscItemFormState>(blankForm())
  const [saving, setSaving] = useState(false)

  const fetchItems = useCallback(async () => {
    setLoadingItems(true)
    setItemError(null)
    try {
      const res = await fetch("/api/misc-items", { cache: "no-store" })
      if (!res.ok) throw new Error("Failed to load misc items")
      const data = (await res.json()) as MiscItemResult[]
      setItems(Array.isArray(data) ? data : [])
    } catch (e) {
      setItemError(e instanceof Error ? e.message : "Failed to load")
      setItems([])
    } finally {
      setLoadingItems(false)
    }
  }, [])

  const fetchMetrics = useCallback(async () => {
    setLoadingMetrics(true)
    setMetricsError(null)
    try {
      const res = await fetch(`/api/misc-items/metrics?from=${from}&to=${to}`, { cache: "no-store" })
      if (res.status === 401 || res.status === 403) {
        setMetrics(null)
        return
      }
      if (!res.ok) throw new Error("Failed to load misc sales metrics")
      const data = (await res.json()) as MiscSalesMetrics
      setMetrics(data)
    } catch (e) {
      setMetricsError(e instanceof Error ? e.message : "Failed to load")
      setMetrics(null)
    } finally {
      setLoadingMetrics(false)
    }
  }, [from, to])

  useEffect(() => {
    void fetchItems()
  }, [fetchItems])

  useEffect(() => {
    void fetchMetrics()
  }, [fetchMetrics])

  const categories = ["ALL", ...MISC_CATEGORIES] as const

  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase()
    return items.filter((item) => {
      if (category !== "ALL" && item.category !== category) return false
      if (!showInactive && !item.active) return false
      if (!text) return true
      return (
        item.name.toLowerCase().includes(text) ||
        (item.barcode ?? "").toLowerCase().includes(text) ||
        item.category.toLowerCase().includes(text) ||
        item.unit.toLowerCase().includes(text)
      )
    })
  }, [items, q, category, showInactive])

  const activeCount = items.filter((item) => item.active).length
  const inactiveCount = items.length - activeCount

  const resetForm = useCallback(() => {
    setForm(blankForm())
  }, [])

  const beginEdit = useCallback((item: MiscItemResult) => {
    setForm({
      id: item.id,
      name: item.name,
      category: item.category,
      unit: item.unit,
      price: Number(item.price).toFixed(2),
      barcode: item.barcode ?? "",
      active: item.active,
      isThirdParty: item.isThirdParty,
    })
  }, [])

  const saveItem = useCallback(async () => {
    setSaving(true)
    setItemError(null)

    try {
      const payload = {
        name: form.name.trim(),
        category: form.category,
        unit: form.unit.trim(),
        price: Number(form.price),
        barcode: form.barcode.trim() || null,
        active: form.active,
        isThirdParty: form.isThirdParty,
      }

      if (!payload.name) throw new Error("Item name is required")
      if (!payload.unit) throw new Error("Unit is required")
      if (!Number.isFinite(payload.price)) throw new Error("Price must be a valid number")

      const res = await fetch(form.id ? `/api/misc-items/${form.id}` : "/api/misc-items", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error ?? "Failed to save item")
      }

      await fetchItems()
      resetForm()
    } catch (e) {
      setItemError(e instanceof Error ? e.message : "Failed to save item")
    } finally {
      setSaving(false)
    }
  }, [fetchItems, form, resetForm])

  return (
    <PageShell title="Misc Sales">
      <div className="mb-6 rounded-2xl border-2 border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-4 text-slate-500">
          <div className="rounded-xl bg-slate-50 p-3">
            <LayoutGrid size={24} className="text-slate-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-700 leading-tight">Revenue Segmentation</p>
            <p className="text-xs font-medium text-slate-400 mt-0.5">
              Misc sales share the POS and Galla but are audited separately for revenue split and settlement.
            </p>
          </div>
        </div>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-[1fr_380px] items-start">
        <section className="rounded-2xl border-2 border-slate-100 bg-white p-6 shadow-sm space-y-6">
          <div className="flex flex-wrap items-center gap-4 border-b-2 border-slate-50 pb-6">
            <div className="flex-1 min-w-[250px] relative">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name / barcode / unit..."
                className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 pl-5 pr-4 py-3.5 text-base font-bold text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all"
              />
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="appearance-none rounded-xl border-2 border-slate-100 bg-slate-50 px-5 py-3.5 text-sm font-black uppercase tracking-widest text-slate-600 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all"
            >
              {categories.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 px-4 py-3 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer border-2 border-transparent hover:border-slate-100">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
              <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">Inactive</span>
            </label>
            <div className="flex items-center gap-2">
              <Button onClick={fetchItems} disabled={loadingItems} variant="secondary" className="rounded-xl px-5 py-3.5 font-black uppercase tracking-widest text-xs">
                {loadingItems ? "..." : "Sync"}
              </Button>
              <Button onClick={resetForm} variant="ghost" className="rounded-xl px-5 py-3.5 font-black uppercase tracking-widest text-xs text-slate-400 hover:text-slate-900">
                New
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6">
            <StatCard label="Active Items" value={String(activeCount)} color="emerald" />
            <StatCard label="Archived" value={String(inactiveCount)} color="slate" />
            <StatCard label="In View" value={String(filtered.length)} color="indigo" />
          </div>

          {itemError && (
            <div className="rounded-xl border-2 border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700 animate-in fade-in">
              {itemError}
            </div>
          )}

          {loadingItems && filtered.length === 0 ? (
            <div className="py-5 text-center text-slate-400 font-bold uppercase tracking-widest text-xs">Syncing Items…</div>
          ) : filtered.length === 0 ? (
            <div className="py-5 text-center text-slate-400 font-bold uppercase tracking-widest text-xs">No entries match filters</div>
          ) : (
            <div className="overflow-hidden rounded-2xl border-2 border-slate-50 shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-[11px] font-black uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="px-6 py-4">Item Catalog</th>
                    <th className="px-6 py-4">Category</th>
                    <th className="px-6 py-4">Barcode</th>
                    <th className="px-6 py-4">Unit</th>
                    <th className="px-6 py-4 text-right">M.R.P</th>
                    <th className="px-6 py-4">Audit Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-slate-50">
                  {filtered.map((item) => (
                    <tr key={item.id} className="group hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-5 font-black text-slate-900 text-base">{item.name}</td>
                      <td className="px-6 py-5">
                        <span className="rounded-full border-2 border-slate-100 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">{item.category}</span>
                      </td>
                      <td className="px-6 py-5 font-mono text-xs font-semibold text-slate-400">{item.barcode ?? "—"}</td>
                      <td className="px-6 py-5 font-bold text-slate-500">{item.unit}</td>
                      <td className="px-6 py-5 text-right font-black text-slate-900 text-lg">{fmt(item.price)}</td>
                      <td className="px-6 py-5">
                        <span
                          className={`rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-widest shadow-sm ${
                            item.active
                              ? "bg-emerald-600 text-white"
                              : "bg-slate-100 text-slate-400"
                          }`}
                        >
                          {item.active ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <Button onClick={() => beginEdit(item)} variant="secondary" size="sm" className="rounded-xl font-black uppercase tracking-widest text-[10px] py-2 px-4 shadow-sm border-2 border-slate-100 hover:border-indigo-200">
                          Configure
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="sticky top-6 rounded-2xl border-2 border-slate-900 bg-white p-4 shadow-2xl space-y-4 animate-in slide-in-from-right-4 duration-500">
          <div>
            <h2 className="text-xl font-black uppercase tracking-tight text-slate-900">
              {form.id ? "Edit Item" : "Create Item"}
            </h2>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">Master Catalog Entry</p>
          </div>

          <div className="grid gap-6">
            <Field label="Item Label / Name">
              <input
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-5 py-4 text-base font-bold text-slate-800 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all"
                placeholder="e.g. Marlboro Lights 10s"
              />
            </Field>
            <Field label="System Category">
              <select
                value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value as MiscItemFormState["category"] }))}
                className="w-full appearance-none rounded-2xl border-2 border-slate-100 bg-slate-50 px-5 py-4 text-base font-bold text-slate-800 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all"
              >
                {MISC_CATEGORIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Sale Unit">
                <input
                  value={form.unit}
                  onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))}
                  className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-5 py-4 text-base font-bold text-slate-800 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all"
                  placeholder="pcs / box"
                />
              </Field>
              <Field label="Fixed M.R.P">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
                  className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-5 py-4 text-xl font-black text-indigo-600 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all"
                />
              </Field>
            </div>
            <Field label="EAN / Barcode (Optional)">
              <input
                value={form.barcode}
                onChange={(e) => setForm((prev) => ({ ...prev, barcode: e.target.value }))}
                className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-5 py-4 text-base font-bold font-mono text-slate-600 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all"
              />
            </Field>

            <div className="grid grid-cols-1 gap-3 rounded-2xl border-2 border-slate-50 bg-slate-50/50 p-5">
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((prev) => ({ ...prev, active: e.target.checked }))}
                  className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 group-hover:text-slate-900 transition-colors">Enabled for Billing</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={form.isThirdParty}
                  onChange={(e) => setForm((prev) => ({ ...prev, isThirdParty: e.target.checked }))}
                  className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 group-hover:text-slate-900 transition-colors">Third-party Revenue Settlement</span>
              </label>
            </div>

            <div className="flex flex-col gap-3 pt-4">
              <Button onClick={saveItem} disabled={saving} className="w-full py-5 text-sm font-black uppercase tracking-[0.2em] shadow-xl active:scale-95 transition-all">
                {saving ? "Processing…" : form.id ? "Commit Updates" : "Register Item"}
              </Button>
              <Button onClick={resetForm} variant="ghost" className="w-full py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-rose-600">
                Cancel / Reset Form
              </Button>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-semibold text-slate-800">Billing note</p>
            <p className="mt-1">
              These items still bill through the shared POS flow. Revenue is split later in cash/ledger reporting,
              while this page only manages the item catalog and misc revenue view.
            </p>
          </div>
        </section>
      </div>

      <section className="rounded-xl border-2 border-slate-100 bg-white p-4 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center gap-6 border-b-2 border-slate-50 pb-8">
          <div>
            <h2 className="text-xl font-black uppercase tracking-tight text-slate-900">Revenue Segmentation</h2>
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 mt-1">Audit Ledger Analytics</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3 rounded-2xl border-2 border-slate-100 bg-slate-50 px-5 py-3 transition-colors focus-within:border-indigo-400 focus-within:bg-white">
              <CalendarDays size={18} className="text-slate-400" />
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="bg-transparent text-base font-bold text-slate-800 focus:outline-none"
              />
            </div>
            <div className="h-px w-4 bg-slate-200" />
            <div className="flex items-center gap-3 rounded-2xl border-2 border-slate-100 bg-slate-50 px-5 py-3 transition-colors focus-within:border-indigo-400 focus-within:bg-white">
              <CalendarDays size={18} className="text-slate-400" />
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="bg-transparent text-base font-bold text-slate-800 focus:outline-none"
              />
            </div>
            <Button onClick={fetchMetrics} disabled={loadingMetrics} variant="secondary" className="rounded-2xl px-6 py-4 font-black uppercase tracking-widest text-xs shadow-lg">
              {loadingMetrics ? "..." : "Audit"}
            </Button>
          </div>
        </div>

        {metricsError && (
          <div className="rounded-xl border-2 border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">
            {metricsError}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-5">
          <StatCard label="Bills Issued" value={String(metrics?.billCount ?? 0)} color="slate" />
          <StatCard label="Total Units" value={String(metrics?.quantity ?? 0)} color="indigo" />
          <StatCard label="Gross Sales" value={fmt(metrics?.grossRevenue ?? 0)} color="emerald" />
          <StatCard label="Owner Split" value={fmt(metrics?.ownerRevenue ?? 0)} color="emerald" />
          <StatCard label="Third-Party" value={fmt(metrics?.thirdPartyRevenue ?? 0)} color="rose" />
        </div>

        {loadingMetrics && !metrics ? (
          <div className="py-6 text-center text-slate-400 font-bold uppercase tracking-widest text-xs">Processing Audit Logs…</div>
        ) : !metrics ? (
          <div className="py-6 text-center text-slate-400 font-bold uppercase tracking-widest text-xs">No analytics for selected range</div>
        ) : (
          <div className="overflow-hidden rounded-2xl border-2 border-slate-50">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-[11px] font-black uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-6 py-4">Revenue Item</th>
                  <th className="px-6 py-4">Classification</th>
                  <th className="px-6 py-4 text-right">Qty</th>
                  <th className="px-6 py-4 text-right">Gross Receipts</th>
                  <th className="px-6 py-4 text-right">Owner Payout</th>
                  <th className="px-6 py-4 text-right">Third-Party Share</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-slate-50">
                {metrics.items.map((item) => (
                  <tr key={`${item.miscItemId ?? item.itemName}-${item.category}`} className="group hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-5 font-black text-slate-900 text-base">{item.itemName}</td>
                    <td className="px-6 py-5">
                      <span className="rounded-full border-2 border-slate-100 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">{item.category}</span>
                    </td>
                    <td className="px-6 py-5 text-right font-black text-slate-600">{item.quantity}</td>
                    <td className="px-6 py-5 text-right font-black text-slate-900 text-lg">{fmt(item.grossRevenue)}</td>
                    <td className="px-6 py-5 text-right font-bold text-emerald-600">{fmt(item.ownerRevenue)}</td>
                    <td className="px-6 py-5 text-right font-bold text-rose-600">{fmt(item.thirdPartyRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageShell>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 block px-1">{label}</label>
      {children}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color: "emerald" | "slate" | "indigo" | "rose" }): JSX.Element {
  const tones = {
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    slate: "border-slate-100 bg-slate-50 text-slate-600",
    indigo: "border-indigo-100 bg-indigo-50 text-indigo-700",
    rose: "border-rose-100 bg-rose-50 text-rose-700",
  }[color]

  return (
    <div className={`rounded-2xl border-2 p-5 shadow-sm transition-all ${tones}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.15em] opacity-60 mb-2">{label}</p>
      <p className="text-2xl font-black tracking-tight">{value}</p>
    </div>
  )
}