'use client'
import { useEffect, useState } from 'react'

export default function SalesPage() {
  const [sales, setSales] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [staffFilter, setStaffFilter] = useState('')
  const [staff, setStaff] = useState<any[]>([])

  useEffect(() => {
    fetch('/api/staff').then(r => r.json()).then(setStaff)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams({ date, limit: '200' })
    if (staffFilter) params.set('staffId', staffFilter)
    setLoading(true)
    fetch(`/api/sales?${params}`).then(r => r.json()).then(d => { setSales(d); setLoading(false) })
  }, [date, staffFilter])

  const totalAmount = sales.reduce((s, x) => s + Number(x.totalAmount), 0)
  const totalBottles = sales.reduce((s, x) => s + x.quantityBottles, 0)

  const paymentTotals = sales.reduce((acc, s) => {
    acc[s.paymentMode] = (acc[s.paymentMode] ?? 0) + Number(s.totalAmount)
    return acc
  }, {} as Record<string, number>)

  const modeIcon: Record<string, string> = { CASH: '', CARD: '', UPI: '', CREDIT: '' }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Sales Log</h1>
        <div className="flex gap-3">
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          <select value={staffFilter} onChange={e => setStaffFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
            <option value="">All Staff</option>
            {staff.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-5 gap-4">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 col-span-1">
          <div className="text-sm text-gray-500">Total Sales</div>
          <div className="text-xl font-bold text-gray-900">₹{totalAmount.toLocaleString('en-IN', {maximumFractionDigits:0})}</div>
          <div className="text-xs text-gray-400">{totalBottles} bottles</div>
        </div>
        {Object.entries(paymentTotals).map(([mode, amount]) => (
          <div key={mode} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-sm text-gray-500">{modeIcon[mode]} {mode}</div>
            <div className="text-lg font-bold text-gray-900">₹{Number(amount).toLocaleString('en-IN', {maximumFractionDigits:0})}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Time</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Product</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Size</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Qty</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Price</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Total</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Payment</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Staff</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Method</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sales.map(s => (
                <tr key={s.id} className={`hover:bg-gray-50 ${s.isManualOverride ? 'bg-yellow-50' : ''}`}>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{new Date(s.saleTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">
                    {s.productSize?.product?.name}
                    {s.isManualOverride && <span className="ml-1 text-xs text-yellow-600" title={s.overrideReason}>⚠️</span>}
                  </td>
                  <td className="px-4 py-2.5 text-center text-gray-500">{s.productSize?.sizeMl}ml</td>
                  <td className="px-4 py-2.5 text-center font-semibold">{s.quantityBottles}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">₹{Number(s.sellingPrice).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-green-700">₹{Number(s.totalAmount).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      s.paymentMode === 'CASH' ? 'bg-green-100 text-green-700' :
                      s.paymentMode === 'CREDIT' ? 'bg-red-100 text-red-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>{modeIcon[s.paymentMode]} {s.paymentMode}</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{s.staff?.name}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="text-xs text-gray-400">
                      {s.scanMethod === 'BARCODE_USB' ? '' : s.scanMethod === 'BARCODE_CAMERA' ? '' : '✍️'}
                    </span>
                  </td>
                </tr>
              ))}
              {sales.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400">No sales for this date</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
