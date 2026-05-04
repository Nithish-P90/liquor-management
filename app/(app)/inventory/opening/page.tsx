"use client"

import { useEffect, useState } from "react"
import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"

type SessionStatus = {
  session: { id: number; periodStart: string; locked: boolean } | null
  rolloverStatus: "up_to_date" | "rolled_over" | "no_history"
}

type SessionUser = {
  id: string
  role?: "ADMIN" | "CASHIER"
}

type OpeningStockItem = {
  productSizeId: number
  productId: number
  name: string
  sizeMl: number
  bottlesPerCase: number
  cases: number
  bottles: number
  totalBottles: number
}

type ProductSize = {
  id: number
  sizeMl: number
  product: { name: string }
}

export default function OpeningInventoryPage(): JSX.Element {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null)
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  const [openingItems, setOpeningItems] = useState<OpeningStockItem[]>([])
  const [products, setProducts] = useState<ProductSize[]>([])
  const [entries, setEntries] = useState<Record<number, { cases: string; bottles: string }>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch("/api/inventory/sessions").then((r) => r.json()),
      fetch("/api/auth/session").then((r) => r.json()),
      fetch("/api/pos/items?kind=LIQUOR").then((r) => r.json()),
    ])
      .then(([status, authSession, items]: [SessionStatus, { user?: SessionUser } | null, unknown]) => {
        if (status) setSessionStatus(status)
        if (authSession?.user) setCurrentUser(authSession.user)
        if (Array.isArray(items)) {
          /* eslint-disable @typescript-eslint/no-explicit-any */
          const sizes = items
            .filter((i: any) => i.kind === "LIQUOR")
            .map((i: any) => i.item)
            .sort((a: any, b: any) => a.product.name.localeCompare(b.product.name))
          /* eslint-enable @typescript-eslint/no-explicit-any */
          setProducts(sizes)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const sessionId = sessionStatus?.session?.id
    if (!sessionId) {
      setOpeningItems([])
      return
    }

    fetch(`/api/inventory/opening?sessionId=${sessionId}`)
      .then(async (response) => {
        const data = (await response.json()) as { error?: string; items?: OpeningStockItem[] }
        if (!response.ok) {
          throw new Error(data.error || "Failed to fetch opening stock")
        }

        if (Array.isArray(data.items)) {
          setOpeningItems(data.items)
          setEntries(
            Object.fromEntries(
              data.items.map((item) => [
                item.productSizeId,
                { cases: String(item.cases), bottles: String(item.bottles) },
              ]),
            ),
          )
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unknown error")
      })
  }, [sessionStatus?.session?.id])

  const isAdmin = currentUser?.role === "ADMIN"

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const items = Object.entries(entries)
      .filter(([, val]) => val.cases !== "" || val.bottles !== "")
      .map(([idStr, val]) => ({
        productSizeId: parseInt(idStr, 10),
        cases: parseInt(val.cases || "0", 10),
        bottles: parseInt(val.bottles || "0", 10),
      }))

    if (items.length === 0) {
      setError("Please enter opening stock for at least one product.")
      setSubmitting(false)
      return
    }

    try {
      if (sessionStatus?.session?.id) {
        const res = await fetch(`/api/inventory/opening?sessionId=${sessionStatus.session.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || "Failed to update opening stock")
        }
      } else {
        const res = await fetch("/api/inventory/opening", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || "Failed to set opening stock")
        }
      }

      setSuccess(true)
      if (sessionStatus?.session?.id) {
        await fetch(`/api/inventory/opening?sessionId=${sessionStatus.session.id}`)
          .then(async (response) => {
            const data = (await response.json()) as { error?: string; items?: OpeningStockItem[] }
            if (!response.ok) {
              throw new Error(data.error || "Failed to refresh opening stock")
            }

            if (Array.isArray(data.items)) {
              setOpeningItems(data.items)
              setEntries(
                Object.fromEntries(
                  data.items.map((item) => [
                    item.productSizeId,
                    { cases: String(item.cases), bottles: String(item.bottles) },
                  ]),
                ),
              )
            }
          })
      } else {
        setEntries({})
        setTimeout(() => {
          window.location.href = "/inventory"
        }, 1500)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setSubmitting(false)
    }
  }

  if (sessionStatus?.session) {
    return (
      <PageShell title="Opening Stock" subtitle="View the opening balance for the current inventory session.">
        <div className="max-w-5xl mx-auto mt-8 space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-2xl font-black text-slate-800">Session Active</h2>
                <p className="text-slate-600 mt-1">Opening stock is visible here for cashiers and editable by admins.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => (window.location.href = "/inventory/catalog")} variant="secondary">
                  View Catalog
                </Button>
                <Button onClick={() => (window.location.href = "/pos")} variant="primary">
                  Go to POS
                </Button>
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
              <p className="text-sm font-bold text-red-900">{error}</p>
            </div>
          )}

          {success && (
            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-lg">
              <p className="text-sm font-bold text-emerald-900">✓ Opening stock updated.</p>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 font-semibold">Product</th>
                  <th className="px-6 py-4 font-semibold text-right">Opening Cases</th>
                  <th className="px-6 py-4 font-semibold text-right">Opening Bottles</th>
                  <th className="px-6 py-4 font-semibold text-right">Current Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {openingItems.map((item) => (
                  <tr key={item.productSizeId} className="hover:bg-slate-50/50">
                    <td className="px-6 py-4">
                      <p className="font-bold text-slate-900">{item.name}</p>
                      <p className="text-xs text-slate-500">{item.sizeMl}ml</p>
                    </td>
                    <td className="px-6 py-4 text-right font-semibold text-slate-700">{item.cases}</td>
                    <td className="px-6 py-4 text-right font-semibold text-slate-700">{item.bottles}</td>
                    <td className="px-6 py-4 text-right font-bold text-slate-900">{item.totalBottles}</td>
                  </tr>
                ))}
                {!openingItems.length && (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-slate-400 font-medium">
                      No opening stock rows found for this session.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {isAdmin && !sessionStatus.session.locked && (
            <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
                <div>
                  <h3 className="font-bold text-slate-800 text-lg">Adjust Opening Stock</h3>
                  <p className="text-sm text-slate-500 mt-1">Admin only. Save the updated opening balance for the active session.</p>
                </div>
                <Button type="submit" variant="primary" disabled={submitting || loading}>
                  {submitting ? "Saving..." : "Save Changes"}
                </Button>
              </div>

              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 font-semibold">Product</th>
                    <th className="px-6 py-4 font-semibold text-right">Cases</th>
                    <th className="px-6 py-4 font-semibold text-right">Bottles</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {openingItems.map((item) => (
                    <tr key={item.productSizeId} className="hover:bg-slate-50/50">
                      <td className="px-6 py-4">
                        <p className="font-bold text-slate-900">{item.name}</p>
                        <p className="text-xs text-slate-500">{item.sizeMl}ml</p>
                      </td>
                      <td className="px-6 py-4">
                        <input
                          type="number"
                          min="0"
                          placeholder="0"
                          value={entries[item.productSizeId]?.cases || ""}
                          onChange={(event) =>
                            setEntries({
                              ...entries,
                              [item.productSizeId]: { ...entries[item.productSizeId], cases: event.target.value },
                            })
                          }
                          className="w-20 text-right rounded border border-slate-300 px-2 py-1 text-slate-900 focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <input
                          type="number"
                          min="0"
                          placeholder="0"
                          value={entries[item.productSizeId]?.bottles || ""}
                          onChange={(event) =>
                            setEntries({
                              ...entries,
                              [item.productSizeId]: { ...entries[item.productSizeId], bottles: event.target.value },
                            })
                          }
                          className="w-20 text-right rounded border border-slate-300 px-2 py-1 text-slate-900 focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </form>
          )}

          {!isAdmin && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-500 shadow-sm">
              Opening stock is read-only for cashiers.
            </div>
          )}
        </div>
      </PageShell>
    )
  }

  // No history — show bootstrap form
  if (sessionStatus?.rolloverStatus === "no_history") {
    return (
      <PageShell title="Opening Stock" subtitle="Bootstrap inventory for day one.">
        <div className="max-w-4xl mx-auto mt-8">
          <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg mb-6">
            <p className="text-sm font-bold text-blue-900">First-Time Setup</p>
            <p className="text-sm text-blue-700 mt-1">Enter the opening stock for your products. These values become the baseline for today&apos;s sales.</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 p-4 rounded-lg mb-6">
              <p className="text-sm font-bold text-red-900">{error}</p>
            </div>
          )}

          {success && (
            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-lg mb-6">
              <p className="text-sm font-bold text-emerald-900">✓ Opening stock saved. Redirecting...</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 font-semibold">Product</th>
                  <th className="px-6 py-4 font-semibold text-right">Cases</th>
                  <th className="px-6 py-4 font-semibold text-right">Bottles</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((size) => (
                  <tr key={size.id} className="hover:bg-slate-50/50">
                    <td className="px-6 py-4">
                      <p className="font-bold text-slate-900">{size.product.name}</p>
                      <p className="text-xs text-slate-500">{size.sizeMl}ml</p>
                    </td>
                    <td className="px-6 py-4">
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={entries[size.id]?.cases || ""}
                        onChange={(e) =>
                          setEntries({
                            ...entries,
                            [size.id]: { ...entries[size.id], cases: e.target.value },
                          })
                        }
                        className="w-20 text-right rounded border border-slate-300 px-2 py-1 text-slate-900 focus:border-blue-500 focus:outline-none"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={entries[size.id]?.bottles || ""}
                        onChange={(e) =>
                          setEntries({
                            ...entries,
                            [size.id]: { ...entries[size.id], bottles: e.target.value },
                          })
                        }
                        className="w-20 text-right rounded border border-slate-300 px-2 py-1 text-slate-900 focus:border-blue-500 focus:outline-none"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex gap-3 justify-end p-6 bg-slate-50 border-t border-slate-200">
              <Button
                onClick={() => (window.location.href = "/inventory")}
                variant="secondary"
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={submitting || loading}>
                {submitting ? "Saving..." : "Save Opening Stock"}
              </Button>
            </div>
          </form>
        </div>
      </PageShell>
    )
  }

  // Loading or other state
  return (
    <PageShell title="Opening Stock" subtitle="Set the initial stock position for the store.">
      <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm max-w-2xl mt-8 text-center mx-auto">
        <p className="text-slate-500">{loading ? "Loading..." : "Checking session status..."}</p>
      </div>
    </PageShell>
  )
}
