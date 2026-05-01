"use client"
import { useEffect, useState } from "react"
import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"

export default function ClosingInventoryPage(): JSX.Element {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [items, setItems] = useState<any[]>([])
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch("/api/pos/items")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setItems(data.filter((d: { kind: string }) => d.kind === "LIQUOR"))
        }
      })
      .catch(() => {})
  }, [])

  async function handleStart() {
    setLoading(true)
    try {
      const res = await fetch("/api/physical-count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" })
      })
      if (!res.ok) throw new Error("Failed to start session")
      const data = await res.json()
      setSessionId(data.sessionId)
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error")
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit() {
    if (!sessionId) return
    const payloadItems = Object.entries(counts).map(([id, val]) => ({
      productSizeId: parseInt(id, 10),
      countedBottles: parseInt(val, 10) || 0
    })).filter(i => i.countedBottles > 0)

    if (payloadItems.length === 0) return alert("Enter at least one count")
    
    setSubmitting(true)
    try {
      const res = await fetch("/api/physical-count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, items: payloadItems })
      })
      if (!res.ok) throw new Error("Failed to submit counts")
      alert("Counts submitted successfully. Waiting for admin approval.")
      window.location.href = "/inventory"
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error")
    } finally {
      setSubmitting(false)
    }
  }

  if (!sessionId) {
    return (
      <PageShell title="Physical Count (Closing)" subtitle="Start a new physical count session.">
        <div className="bg-white p-8 rounded-xl border border-slate-200 text-center max-w-lg shadow-sm mx-auto mt-10">
          <h2 className="text-xl font-black text-slate-800 mb-2">Begin Count Session</h2>
          <p className="text-slate-500 mb-6 text-sm">Lock the inventory state and begin recording physical bottle counts for the end-of-day process.</p>
          <Button onClick={handleStart} variant="primary" disabled={loading} className="w-full py-3">
            {loading ? "Starting..." : "Start Session"}
          </Button>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell title={`Active Count Session #${sessionId}`} subtitle="Enter physical bottle counts for all available products.">
      <div className="mb-6 flex justify-between items-center bg-indigo-50 border border-indigo-100 p-4 rounded-xl">
        <p className="text-sm font-bold text-indigo-700">Only items with entered quantities will be recorded.</p>
        <Button onClick={handleSubmit} variant="primary" disabled={submitting}>
          {submitting ? "Submitting..." : "Submit Counts"}
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white max-w-3xl shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-6 py-4 font-semibold">Product</th>
              <th className="px-6 py-4 font-semibold w-48 text-right">Physical Count (Bottles)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((it) => (
              <tr key={it.item.id} className="hover:bg-slate-50/50">
                <td className="px-6 py-4">
                  <p className="font-bold text-slate-900">{it.item.product.name}</p>
                  <p className="text-xs text-slate-500">{it.item.sizeMl}ml</p>
                </td>
                <td className="px-6 py-4">
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={counts[it.item.id] || ""}
                    onChange={e => setCounts({...counts, [it.item.id]: e.target.value})}
                    className="w-full text-right rounded-lg border border-slate-300 px-4 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none font-bold"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  )
}
