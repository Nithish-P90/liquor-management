'use client'
import { useState, useEffect } from 'react'

export default function ReportsPage() {
  const [sessions, setSessions] = useState<any[]>([])
  const [selectedSession, setSelectedSession] = useState<number | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [reportDate] = useState(new Date().toISOString().slice(0,10))

  useEffect(() => {
    fetch('/api/inventory/sessions').then(r => r.json()).then(s => {
      setSessions(s)
      if (s[0]) setSelectedSession(s[0].id)
    })
  }, [])

  async function downloadStockSheet() {
    if (!selectedSession) return
    setDownloading(true)
    const res = await fetch(`/api/reports/stock-sheet?sessionId=${selectedSession}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'MV-Stock-Sheet.xlsx'; a.click()
    URL.revokeObjectURL(url)
    setDownloading(false)
  }

  const reportCards = [
    {
      title: 'Physical Stock Sheet',
      desc: 'Export 6-sheet Excel matching MV format (Opening, Receipts, Total, Closing, Sales & Rate, Expenditure)',
      icon: '',
      color: 'blue',
      action: downloadStockSheet,
      actionLabel: 'Download Excel',
    },
    {
      title: 'Daily Sales Report',
      desc: 'All sales for a specific date, grouped by product and payment mode',
      icon: '',
      color: 'green',
      href: `/sales?date=${reportDate}`,
    },
    {
      title: 'Variance / Discrepancy Report',
      desc: 'All stock variances found during reconciliation, filterable by date and severity',
      icon: '',
      color: 'red',
      href: '/alerts',
    },
    {
      title: 'Staff Sales Log',
      desc: 'Sales breakdown per staff member — accountability and shift performance',
      icon: '',
      color: 'purple',
      href: '/sales',
    },
    {
      title: 'Expenditure Report',
      desc: 'All expenses for a period, categorized by type with totals',
      icon: '',
      color: 'orange',
      href: '/expenses',
    },
    {
      title: 'Cash Reconciliation',
      desc: 'Daily cash flow: Galla, Locker, Digital, Credit bills',
      icon: '',
      color: 'teal',
      href: '/cash',
    },
  ]

  const colorMap: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50',
    green: 'border-green-200 bg-green-50',
    red: 'border-red-200 bg-red-50',
    purple: 'border-purple-200 bg-purple-50',
    orange: 'border-orange-200 bg-orange-50',
    teal: 'border-teal-200 bg-teal-50',
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Reports & Exports</h1>

      {/* Stock Sheet Download */}
      <div className="bg-white rounded-xl border border-blue-200 p-6">
        <h2 className="font-bold text-gray-800 text-lg mb-4"> Physical Stock Sheet (Excel)</h2>
        <p className="text-sm text-gray-500 mb-4">
          Downloads 6-sheet Excel workbook exactly matching the MV Physical Stock Sheet format.
          Includes Opening Stock, Receipts, Total Stock, Closing Stock, Sales & Rate, Expenditure.
        </p>
        <div className="flex gap-4 items-center">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Inventory Session</label>
            <select value={selectedSession ?? ''} onChange={e => setSelectedSession(+e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none min-w-64">
              {sessions.length === 0 && <option value="">No sessions yet</option>}
              {sessions.map(s => (
                <option key={s.id} value={s.id}>
                  Session #{s.id} — {new Date(s.periodStart).toLocaleDateString('en-IN')} to {new Date(s.periodEnd).toLocaleDateString('en-IN')}
                </option>
              ))}
            </select>
          </div>
          <button onClick={downloadStockSheet} disabled={downloading || !selectedSession}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors mt-5">
            {downloading ? '⏳ Generating...' : '⬇️ Download Stock Sheet'}
          </button>
        </div>
      </div>

      {/* Other Reports */}
      <div className="grid grid-cols-2 gap-4">
        {reportCards.slice(1).map((card, i) => (
          <div key={i} className={`rounded-xl border p-5 ${colorMap[card.color]}`}>
            <div className="flex items-start gap-3">
              <span className="text-3xl">{card.icon}</span>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-800">{card.title}</h3>
                <p className="text-sm text-gray-500 mt-1">{card.desc}</p>
                {card.href && (
                  <a href={card.href} className="inline-block mt-3 px-4 py-1.5 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                    View Report →
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
