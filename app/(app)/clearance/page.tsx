"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/Button"
import { PageShell } from "@/components/PageShell"

type Batch = {
  id: number
  productSize: { id: number; sizeMl: number; product: { name: string; category: string } }
  originalRate: string
  clearanceRate: string
  totalQuantity: number
  soldQuantity: number
  status: string
  reason: string | null
  createdBy: { name: string }
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-emerald-900/50 text-emerald-300",
  EXHAUSTED: "bg-slate-700 text-slate-400",
  CANCELLED: "bg-red-900/50 text-red-300",
}

export default function ClearancePage(): JSX.Element {
  const [batches, setBatches] = useState<Batch[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ productSizeId: "", clearanceRate: "", totalQuantity: "", reason: "" })
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok: boolean): void {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  async function fetchBatches(): Promise<void> {
    setLoading(true)
    try {
      const res = await fetch("/api/clearance")
      const data = await res.json()
      if (Array.isArray(data)) setBatches(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchBatches() }, [])

  async function handleCreate(): Promise<void> {
    const res = await fetch("/api/clearance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productSizeId: parseInt(form.productSizeId, 10),
        clearanceRate: parseFloat(form.clearanceRate),
        totalQuantity: parseInt(form.totalQuantity, 10),
        reason: form.reason || undefined,
      }),
    })
    if (res.ok) {
      showToast("Clearance batch created", true)
      setShowCreate(false)
      setForm({ productSizeId: "", clearanceRate: "", totalQuantity: "", reason: "" })
      fetchBatches()
    } else {
      const err = await res.json()
      showToast(err.error ?? "Create failed", false)
    }
  }

  async function handleCancel(id: number): Promise<void> {
    const res = await fetch(`/api/clearance/${id}/cancel`, { method: "POST" })
    if (res.ok) {
      showToast("Batch cancelled", true)
      fetchBatches()
    } else {
      const err = await res.json()
      showToast(err.error ?? "Cancel failed", false)
    }
  }

  return (
    <PageShell title="Clearance Batches" subtitle="Owner-controlled temporary pricing for specific variants.">
      {toast && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium ${toast.ok ? "bg-emerald-900/50 text-emerald-300" : "bg-red-900/50 text-red-300"}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-4 flex justify-end">
        <Button onClick={() => setShowCreate(true)}>New Clearance Batch</Button>
      </div>

      {showCreate && (
        <div className="mb-6 rounded-lg border border-slate-700 bg-slate-800/50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-200">Create Clearance Batch</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              ["Product Size ID", "productSizeId", "number"],
              ["Clearance Rate (₹)", "clearanceRate", "number"],
              ["Total Quantity (bottles)", "totalQuantity", "number"],
              ["Reason (optional)", "reason", "text"],
            ].map(([label, key, type]) => (
              <div key={key}>
                <label className="mb-1 block text-xs text-slate-400">{label}</label>
                <input
                  type={type}
                  value={form[key as keyof typeof form]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-3">
            <Button onClick={handleCreate}>Create</Button>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : batches.length === 0 ? (
        <p className="text-sm text-slate-400">No clearance batches.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60">
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Original Rate</th>
                <th className="px-4 py-3">Clearance Rate</th>
                <th className="px-4 py-3">Progress</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-100">{batch.productSize.product.name}</p>
                    <p className="text-xs text-slate-400">{batch.productSize.sizeMl}ml</p>
                  </td>
                  <td className="px-4 py-3 text-slate-300">₹{batch.originalRate}</td>
                  <td className="px-4 py-3 font-medium text-emerald-400">₹{batch.clearanceRate}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {batch.soldQuantity} / {batch.totalQuantity} bottles
                    <div className="mt-1 h-1.5 w-full rounded-full bg-slate-700">
                      <div
                        className="h-1.5 rounded-full bg-emerald-500"
                        style={{ width: `${Math.min(100, (batch.soldQuantity / batch.totalQuantity) * 100)}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[batch.status] ?? "bg-slate-700 text-slate-400"}`}>
                      {batch.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {batch.status === "ACTIVE" && (
                      <Button size="sm" variant="danger" onClick={() => handleCancel(batch.id)}>Cancel</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  )
}
