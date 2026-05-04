"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/Button"
import { PageShell } from "@/components/PageShell"

type IndentRow = {
  id: number
  indentNumber: string
  retailerName: string
  indentDate: string
  status: string
  items: Array<{ id: number; isNewItem: boolean }>
  receipts: Array<{ id: number }>
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700 border-amber-200",
  PARTIAL: "bg-blue-100 text-blue-700 border-blue-200",
  FULLY_RECEIVED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  STOCK_ADDED: "bg-slate-900 text-white border-slate-900",
}

export default function IndentsPage(): JSX.Element {
  const [indents, setIndents] = useState<IndentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok: boolean): void {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  async function fetchIndents(): Promise<void> {
    setLoading(true)
    try {
      const res = await fetch("/api/indents")
      const data = await res.json()
      setIndents(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchIndents() }, [])

  async function handleConfirm(id: number): Promise<void> {
    const res = await fetch(`/api/indents/${id}/confirm`, { method: "POST" })
    if (res.ok) {
      showToast("Stock added", true)
      fetchIndents()
    } else {
      const err = await res.json()
      showToast(err.error ?? "Confirm failed", false)
    }
  }

  return (
    <PageShell title="Procurement Registry" subtitle="Manage KSBCL digital indents, review automated item parsing, and reconcile inventory arrival.">
      {toast && (
        <div className={`mb-8 rounded-2xl border-2 px-6 py-4 text-sm font-black uppercase tracking-widest animate-in slide-in-from-top-4 ${toast.ok ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-rose-100 bg-rose-50 text-rose-700"}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-10 flex justify-between items-center border-b-2 border-slate-50 pb-8">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Indent Stream</h2>
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 mt-1">Stock Acquisition Audit</p>
        </div>
        <Link href="/indents/upload">
          <Button variant="primary" className="flex items-center gap-3 px-8 py-4 rounded-2xl shadow-xl shadow-slate-900/10 font-black uppercase tracking-widest text-[11px] active:scale-95 transition-all">
            <Plus size={18} /> Upload Indent PDF
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="py-20 text-center text-slate-400 font-black uppercase tracking-[0.2em] text-[11px]">Syncing Procurement Data…</div>
      ) : indents.length === 0 ? (
        <div className="py-24 text-center border-4 border-slate-50 border-dashed rounded-[3rem]">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">No procurement records found</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border-2 border-slate-50 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 border-b-2 border-slate-50">
              <tr>
                <th className="px-6 py-5">Sequential ID</th>
                <th className="px-6 py-5">Retailer Entity</th>
                <th className="px-6 py-5">Audit Date</th>
                <th className="px-6 py-5">Line Count</th>
                <th className="px-6 py-5">Status</th>
                <th className="px-6 py-5 text-center">Management</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-50">
              {indents.map((indent) => {
                const unmapped = indent.items.filter((i) => i.isNewItem).length
                return (
                  <tr key={indent.id} className="group hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-5 font-black text-slate-900 font-mono text-base">{indent.indentNumber}</td>
                    <td className="px-6 py-5 font-black text-slate-700 uppercase tracking-tight text-xs">{indent.retailerName}</td>
                    <td className="px-6 py-5 text-slate-400 font-bold uppercase tracking-widest text-[10px]">{indent.indentDate?.slice(0, 10)}</td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-slate-700">{indent.items.length} Units</span>
                        {unmapped > 0 && (
                          <span className="rounded-lg bg-rose-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-rose-600 border border-rose-100">
                            {unmapped} Unmapped
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className={`rounded-xl border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest shadow-sm ${STATUS_COLORS[indent.status] ?? "bg-slate-50 text-slate-400 border-slate-200"}`}>
                        {indent.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex gap-4 justify-center">
                        <Link href={`/indents/${indent.id}`}>
                          <button className="text-indigo-600 hover:text-indigo-900 text-[10px] font-black uppercase tracking-widest transition-colors">Review Registry</button>
                        </Link>
                        {indent.status !== "STOCK_ADDED" && unmapped === 0 && (
                          <button onClick={() => handleConfirm(indent.id)} className="text-emerald-600 hover:text-emerald-900 text-[10px] font-black uppercase tracking-widest transition-colors">Confirm Arrival</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  )
}
