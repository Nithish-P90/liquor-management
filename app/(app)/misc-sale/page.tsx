'use client'
import { useEffect, useState } from 'react'

type MiscSale = {
  id: number
  saleTime: string
  productName: string
  sizeMl: number
  quantityBottles: number
  totalAmount: number
  paymentMode: string
}

type TallyRow = {
  productName: string
  sizeMl: number
  bottles: number
  amount: number
}

function rupee(n: number) {
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

export default function MiscSalePage() {
  const [sales, setSales] = useState<MiscSale[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))

  useEffect(() => {
    setLoading(true)
    fetch(`/api/sales?date=${date}&limit=200`)
      .then(r => r.json())
      .then((data: any[]) => {
        const misc = data
          .filter(s => s.productSize?.product?.category === 'MISCELLANEOUS')
          .map(s => ({
            id: s.id,
            saleTime: s.saleTime,
            productName: s.productSize.product.name,
            sizeMl: s.productSize.sizeMl,
            quantityBottles: s.quantityBottles,
            totalAmount: Number(s.totalAmount),
            paymentMode: s.paymentMode,
          }))
        setSales(misc)
        setLoading(false)
      })
  }, [date])

  // Aggregate by product
  const tally = Object.values(
    sales.reduce<Record<string, TallyRow>>((acc, s) => {
      const key = `${s.productName}-${s.sizeMl}`
      if (!acc[key]) acc[key] = { productName: s.productName, sizeMl: s.sizeMl, bottles: 0, amount: 0 }
      acc[key].bottles += s.quantityBottles
      acc[key].amount += s.totalAmount
      return acc
    }, {})
  )

  const totalBottles = tally.reduce((s, r) => s + r.bottles, 0)
  const totalAmount = tally.reduce((s, r) => s + r.amount, 0)

  const cigarettesQty = tally.filter(r => /cigarette/i.test(r.productName)).reduce((s, r) => s + r.bottles, 0)
  const snacksQty = tally.filter(r => /snack/i.test(r.productName)).reduce((s, r) => s + r.bottles, 0)
  const cupsQty = tally.filter(r => /cup|tea|coffee/i.test(r.productName)).reduce((s, r) => s + r.bottles, 0)

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Miscellaneous Sales</h1>
          <p className="text-slate-400 text-sm mt-0.5">Daily tally for miscellaneous items</p>
        </div>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 border-l-4 border-l-violet-500 rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Total Misc Revenue</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{rupee(totalAmount)}</p>
        </div>
        <div className="bg-white border border-slate-200 border-l-4 border-l-amber-500 rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Cigarettes Sold</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{cigarettesQty}</p>
        </div>
        <div className="bg-white border border-slate-200 border-l-4 border-l-emerald-500 rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Snacks Sold</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{snacksQty}</p>
        </div>
        <div className="bg-white border border-slate-200 border-l-4 border-l-blue-500 rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Cups Sold</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{cupsQty}</p>
        </div>
      </div>

      {/* Product-wise tally */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-700">Product-wise Tally</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tally.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">No miscellaneous sales for this day</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 font-semibold text-slate-500">Product</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-500">Size</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-500">Bottles</th>
                <th className="text-right px-5 py-3 font-semibold text-slate-500">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {tally.map((r, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-800">{r.productName}</td>
                  <td className="px-4 py-3 text-center text-slate-500">{r.sizeMl}ml</td>
                  <td className="px-4 py-3 text-center font-bold text-slate-700">{r.bottles}</td>
                  <td className="px-5 py-3 text-right font-bold text-slate-900">{rupee(r.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-800 text-white">
              <tr>
                <td colSpan={2} className="px-5 py-3 font-bold text-sm">Total</td>
                <td className="px-4 py-3 text-center font-black">{totalBottles}</td>
                <td className="px-5 py-3 text-right font-black">{rupee(totalAmount)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Individual transactions */}
      {sales.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
            <h2 className="text-sm font-bold text-slate-700">Transaction Log ({sales.length} bills)</h2>
          </div>
          <div className="divide-y divide-slate-50 max-h-64 overflow-y-auto">
            {sales.map(s => (
              <div key={s.id} className="px-5 py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-semibold text-slate-800">{s.productName} {s.sizeMl}ml</p>
                  <p className="text-xs text-slate-400">
                    {new Date(s.saleTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · {s.paymentMode} · {s.quantityBottles} btl
                  </p>
                </div>
                <span className="font-bold text-slate-900">{rupee(s.totalAmount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
