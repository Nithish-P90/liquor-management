"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

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
  PENDING: "bg-amber-900/50 text-amber-300",
  PARTIAL: "bg-blue-900/50 text-blue-300",
  FULLY_RECEIVED: "bg-green-900/50 text-green-300",
  STOCK_ADDED: "bg-emerald-900/50 text-emerald-300",
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
    <PageShell title="KSBCL Indents" subtitle="Upload PDF, review parsed items, confirm arrival to add stock.">
      {toast && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium ${toast.ok ? "bg-emerald-900/50 text-emerald-300" : "bg-red-900/50 text-red-300"}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-4 flex justify-end">
        <Link href="/indents/upload">
          <Button variant="primary">Upload PDF</Button>
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : indents.length === 0 ? (
        <p className="text-sm text-slate-400">No indents yet. Upload a KSBCL PDF to get started.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60">
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Indent No</th>
                <th className="px-4 py-3">Retailer</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {indents.map((indent) => {
                const unmapped = indent.items.filter((i) => i.isNewItem).length
                return (
                  <tr key={indent.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-mono text-slate-200">{indent.indentNumber}</td>
                    <td className="px-4 py-3 text-slate-300">{indent.retailerName}</td>
                    <td className="px-4 py-3 text-slate-400">{indent.indentDate?.slice(0, 10)}</td>
                    <td className="px-4 py-3 text-slate-300">
                      {indent.items.length} items
                      {unmapped > 0 && (
                        <span className="ml-2 rounded-full bg-amber-900/50 px-2 py-0.5 text-xs text-amber-300">
                          {unmapped} unmapped
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[indent.status] ?? "bg-slate-800 text-slate-400"}`}>
                        {indent.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Link href={`/indents/${indent.id}`}>
                          <Button size="sm" variant="secondary">Review</Button>
                        </Link>
                        {indent.status !== "STOCK_ADDED" && unmapped === 0 && (
                          <Button size="sm" variant="primary" onClick={() => handleConfirm(indent.id)}>
                            Confirm
                          </Button>
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
