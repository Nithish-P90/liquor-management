"use client"

import { useEffect, useState } from "react"
import { Plus } from "lucide-react"

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
  ACTIVE: "bg-emerald-100 text-emerald-700 border-emerald-200",
  EXHAUSTED: "bg-slate-900 text-white border-slate-900",
  CANCELLED: "bg-rose-100 text-rose-700 border-rose-200",
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
    <PageShell title="Liquidation Registry">
      {toast && (
        <div className={`mb-4 rounded-2xl border-2 px-6 py-4 text-sm font-black uppercase tracking-widest animate-in slide-in-from-top-4 ${toast.ok ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-rose-100 bg-rose-50 text-rose-700"}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-5 flex justify-between items-center border-b-2 border-slate-50 pb-8">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Clearance Stream</h2>
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 mt-1">Strategic Pricing Management</p>
        </div>
        <Button onClick={() => setShowCreate(true)} variant="primary" className="flex items-center gap-3 px-4 py-4 rounded-2xl shadow-xl shadow-slate-900/10 font-black uppercase tracking-widest text-[11px] active:scale-95 transition-all">
          <Plus size={18} /> Initiate Clearance
        </Button>
      </div>

      {showCreate && (
        <div className="mb-5 rounded-xl border-2 border-slate-100 bg-white p-4 shadow-sm animate-in slide-in-from-top-4 duration-500">
          <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-6">Initialize New Pricing Module</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              ["Target Article ID", "productSizeId", "number", "variant#"],
              ["Clearance Payout (₹)", "clearanceRate", "number", "0.00"],
              ["Allocation Volume", "totalQuantity", "number", "bottles"],
              ["Strategic Rationale", "reason", "text", "short context"],
            ].map(([label, key, type, ph]) => (
              <div key={key}>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2 px-1">{label}</label>
                <input
                  type={type}
                  placeholder={ph}
                  value={form[key as keyof typeof form]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-5 py-4 text-base font-black text-slate-800 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all"
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-4">
            <Button onClick={handleCreate} className="rounded-2xl px-5 py-4 font-black uppercase tracking-widest text-[11px] shadow-xl">Activate Batch</Button>
            <Button variant="ghost" onClick={() => setShowCreate(false)} className="rounded-2xl px-6 py-4 font-black uppercase tracking-widest text-[11px] text-slate-400">Cancel</Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-3 text-center text-slate-400 font-black uppercase tracking-[0.2em] text-[11px]">Syncing Liquidation Data…</div>
      ) : batches.length === 0 ? (
        <div className="py-3 text-center border-4 border-slate-50 border-dashed rounded-xl">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">No active clearance sessions</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border-2 border-slate-50 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 border-b-2 border-slate-50">
              <tr>
                <th className="px-6 py-5">Article Identity</th>
                <th className="px-6 py-5 text-right">Standard Rate</th>
                <th className="px-6 py-5 text-right">Clearance Rate</th>
                <th className="px-6 py-5">Liquidation Progress</th>
                <th className="px-6 py-5 text-center">Status</th>
                <th className="px-6 py-5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-50">
              {batches.map((batch) => (
                <tr key={batch.id} className="group hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-5">
                    <p className="font-black text-slate-900 text-base tracking-tight">{batch.productSize.product.name}</p>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">{batch.productSize.sizeMl}ML · {batch.productSize.product.category}</p>
                  </td>
                  <td className="px-6 py-5 text-right text-slate-400 font-bold tabular-nums">₹{batch.originalRate}</td>
                  <td className="px-6 py-5 text-right font-black text-emerald-600 text-base tabular-nums">₹{batch.clearanceRate}</td>
                  <td className="px-6 py-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{batch.soldQuantity} / {batch.totalQuantity} Sold</span>
                      <span className="text-[10px] font-black text-slate-900">{Math.round((batch.soldQuantity / batch.totalQuantity) * 100)}%</span>
                    </div>
                    <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden border-2 border-slate-50 shadow-inner">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all duration-1000 shadow-sm"
                        style={{ width: `${Math.min(100, (batch.soldQuantity / batch.totalQuantity) * 100)}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-6 py-5 text-center">
                    <span className={`rounded-xl border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest shadow-sm ${STATUS_COLORS[batch.status] ?? "bg-slate-50 text-slate-400 border-slate-200"}`}>
                      {batch.status}
                    </span>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex justify-center">
                      {batch.status === "ACTIVE" && (
                        <button onClick={() => handleCancel(batch.id)} className="text-rose-400 hover:text-rose-600 text-[10px] font-black uppercase tracking-widest transition-colors">Terminate Batch</button>
                      )}
                    </div>
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
