"use client"

import { useEffect, useState } from "react"

import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"

type StockRow = {
  productSizeId: number
  productId: number
  name: string
  sizeMl: number
  cases: number
  bottles: number
  openingBottles: number
  totalBottles: number
}

type SessionUser = {
  id: string
  role?: "ADMIN" | "CASHIER"
}

export default function InventoryCatalogPage(): JSX.Element {
  const [rows, setRows] = useState<StockRow[]>([])
  const [loading, setLoading] = useState(true)
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)

  useEffect(() => {
    Promise.all([
      fetch("/api/inventory/stock?limit=500").then((response) => response.json()),
      fetch("/api/auth/session").then((response) => response.json()),
    ])
      .then(([stockData, session]: [
        { items?: StockRow[] },
        { user?: SessionUser } | SessionUser | null,
      ]) => {
        if (Array.isArray(stockData.items)) {
          setRows(stockData.items)
        }

        if (session && typeof session === "object" && "user" in session && session.user) {
          setCurrentUser(session.user)
        } else if (session && typeof session === "object" && "role" in session) {
          setCurrentUser(session as SessionUser)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  const isAdmin = currentUser?.role === "ADMIN"

  return (
    <PageShell title="Inventory Catalog">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm mt-4 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-800">Live Inventory</h2>
            <p className="text-sm text-slate-500 mt-1">Cashiers can view this catalog. Admins can jump to opening stock adjustments.</p>
          </div>
          {isAdmin && (
            <Button onClick={() => (window.location.href = "/inventory/opening")} variant="primary">
              Adjust Opening Stock
            </Button>
          )}
        </div>

        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 font-semibold">Product</th>
              <th className="px-6 py-4 font-semibold text-right">Opening</th>
              <th className="px-6 py-4 font-semibold text-right">Current</th>
              <th className="px-6 py-4 font-semibold text-right">Cases</th>
              <th className="px-6 py-4 font-semibold text-right">Bottles</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.productSizeId} className="hover:bg-slate-50/50">
                <td className="px-6 py-4">
                  <p className="font-bold text-slate-900">{row.name}</p>
                  <p className="text-xs text-slate-500">{row.sizeMl}ml</p>
                </td>
                <td className="px-6 py-4 text-right font-semibold text-slate-700">{row.openingBottles}</td>
                <td className="px-6 py-4 text-right font-bold text-slate-900">{row.totalBottles}</td>
                <td className="px-6 py-4 text-right font-semibold text-slate-700">{row.cases}</td>
                <td className="px-6 py-4 text-right font-semibold text-slate-700">{row.bottles}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-3 text-center text-slate-400 font-medium">
                  No inventory rows found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  )
}