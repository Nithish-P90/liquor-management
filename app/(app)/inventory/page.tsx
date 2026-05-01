"use client"

import { useEffect, useState } from "react"
import { PageShell } from "@/components/PageShell"

export default function InventoryOverviewPage(): JSX.Element {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sessions, setSessions] = useState<any[]>([])

  useEffect(() => {
    fetch("/api/physical-count").then(r => r.json()).then(data => {
      if (Array.isArray(data)) setSessions(data)
    })
  }, [])

  return (
    <PageShell title="Inventory Hub" subtitle="Current stock visibility and physical count workflows.">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl border border-slate-200 flex flex-col items-start gap-4 shadow-sm hover:border-slate-300 transition-all">
          <div>
            <h3 className="font-bold text-slate-800 text-lg">Opening Stock</h3>
            <p className="text-sm text-slate-500 mt-1">Set or adjust the opening stock balance for the current inventory session.</p>
          </div>
          <a href="/inventory/opening" className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-bold mt-auto hover:bg-slate-800">Enter Opening Stock</a>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200 flex flex-col items-start gap-4 shadow-sm hover:border-slate-300 transition-all">
          <div>
            <h3 className="font-bold text-slate-800 text-lg">Physical Count (Closing)</h3>
            <p className="text-sm text-slate-500 mt-1">Record physical closing counts and review system variances before day close.</p>
          </div>
          <a href="/inventory/closing" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold mt-auto hover:bg-indigo-500">Start Physical Count</a>
        </div>
      </div>

      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">Recent Count Sessions</h3>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-6 py-4 font-semibold">ID</th>
              <th className="px-6 py-4 font-semibold">Status</th>
              <th className="px-6 py-4 font-semibold">Conducted By</th>
              <th className="px-6 py-4 font-semibold">Items Counted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sessions.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50/50">
                <td className="px-6 py-4 font-mono text-xs text-slate-500">{s.id}</td>
                <td className="px-6 py-4">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    s.status === "APPROVED" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                  }`}>
                    {s.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-slate-900 font-bold">{s.conductedBy?.name || "—"}</td>
                <td className="px-6 py-4 text-slate-600 font-bold">{s.items?.length || 0} items</td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr><td colSpan={4} className="px-6 py-8 text-center text-slate-400 font-medium">No recent physical counts found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  )
}
