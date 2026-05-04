"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"

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
    <PageShell title="Misc Sales" subtitle="Manage misc items and review the revenue split that is separated later in reports.">
      <div className="mb-4 rounded-xl border border-slate-200 bg-white/80 p-4 text-sm text-slate-700 shadow-sm">
        Misc sales are billed through the same POS and collected into the same galla as liquor. This page manages the
        item list and shows the misc revenue split separately for later settlement.
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px]">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name / barcode / unit..."
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
            >
              {categories.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show inactive
            </label>
            <Button onClick={fetchItems} disabled={loadingItems} variant="secondary">
              {loadingItems ? "Refreshing..." : "Refresh"}
            </Button>
            <Button onClick={resetForm} variant="ghost">
              New item
            </Button>
            <a
              href="/pos"
              className="ml-auto rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Open POS
            </a>
          </div>

          <div className="mb-4 grid grid-cols-3 gap-3">
            <StatCard label="Active" value={String(activeCount)} />
            <StatCard label="Inactive" value={String(inactiveCount)} />
            <StatCard label="Visible" value={String(filtered.length)} />
          </div>

          {itemError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {itemError}
            </div>
          )}

          {loadingItems && filtered.length === 0 ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-slate-500">No misc items.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Barcode</th>
                    <th className="px-4 py-3">Unit</th>
                    <th className="px-4 py-3 text-right">Price</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id} className="border-t border-slate-200">
                      <td className="px-4 py-3 font-semibold text-slate-900">{item.name}</td>
                      <td className="px-4 py-3 text-slate-700">{item.category}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{item.barcode ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-700">{item.unit}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(item.price)}</td>
                      <td className="px-4 py-3 text-slate-700">
                        <span
                          className={
                            item.active
                              ? "rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700"
                              : "rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600"
                          }
                        >
                          {item.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button onClick={() => beginEdit(item)} variant="secondary" size="sm">
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">
            {form.id ? "Edit misc item" : "Add misc item"}
          </h2>

          <div className="mt-4 grid gap-3">
            <Field label="Name">
              <input
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Category">
              <select
                value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value as MiscItemFormState["category"] }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {MISC_CATEGORIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Unit">
                <input
                  value={form.unit}
                  onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Price">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </Field>
            </div>
            <Field label="Barcode">
              <input
                value={form.barcode}
                onChange={(e) => setForm((prev) => ({ ...prev, barcode: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((prev) => ({ ...prev, active: e.target.checked }))}
                />
                Active
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.isThirdParty}
                  onChange={(e) => setForm((prev) => ({ ...prev, isThirdParty: e.target.checked }))}
                />
                Third-party revenue
              </label>
            </div>

            <div className="flex gap-2">
              <Button onClick={saveItem} disabled={saving}>
                {saving ? "Saving..." : form.id ? "Update item" : "Create item"}
              </Button>
              <Button onClick={resetForm} variant="secondary">
                Clear
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

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Sales metrics</h2>
            <p className="text-sm text-slate-500">Misc line revenue from committed bills in the selected range.</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            />
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            />
            <Button onClick={fetchMetrics} disabled={loadingMetrics} variant="secondary">
              {loadingMetrics ? "Refreshing..." : "Refresh metrics"}
            </Button>
          </div>
        </div>

        {metricsError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {metricsError}
          </div>
        )}

        <div className="mb-4 grid gap-3 md:grid-cols-5">
          <StatCard label="Bills" value={String(metrics?.billCount ?? 0)} />
          <StatCard label="Qty" value={String(metrics?.quantity ?? 0)} />
          <StatCard label="Gross" value={fmt(metrics?.grossRevenue ?? 0)} />
          <StatCard label="Owner" value={fmt(metrics?.ownerRevenue ?? 0)} />
          <StatCard label="Third-party" value={fmt(metrics?.thirdPartyRevenue ?? 0)} />
        </div>

        {loadingMetrics && !metrics ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : !metrics ? (
          <p className="text-sm text-slate-500">No metrics available for this range.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Gross</th>
                  <th className="px-4 py-3 text-right">Owner</th>
                  <th className="px-4 py-3 text-right">Third-party</th>
                </tr>
              </thead>
              <tbody>
                {metrics.items.map((item) => (
                  <tr key={`${item.miscItemId ?? item.itemName}-${item.category}`} className="border-t border-slate-200">
                    <td className="px-4 py-3 font-semibold text-slate-900">{item.itemName}</td>
                    <td className="px-4 py-3 text-slate-700">{item.category}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{item.quantity}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(item.grossRevenue)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{fmt(item.ownerRevenue)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{fmt(item.thirdPartyRevenue)}</td>
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
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function StatCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-extrabold text-slate-900">{value}</p>
    </div>
  )
}