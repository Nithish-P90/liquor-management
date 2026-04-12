'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type DaySummary = {
  todaySales: { bills: number; bottles: number; totalAmount: number }
  currentSession: {
    id: number
    periodStart: string
    periodEnd: string
    hasClosing: boolean
  } | null
}

function fmt(n: number) {
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

export default function CloseDayPage() {
  const router = useRouter()
  const [step, setStep] = useState<'summary' | 'result'>('summary')
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<DaySummary | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)

  // Load day summary
  useEffect(() => {
    fetch('/api/inventory/close-day')
      .then(r => r.json())
      .then(data => { setSummary(data); setLoading(false) })
  }, [])

  async function autoSubmitClosingStock() {
    if (!confirm("This will automatically snapshot the system's calculated expected stock as today's exact closing stock, and carry it forward as tomorrow's opening stock. Proceed?")) return;
    setSaving(true)
    try {
      // 1. Fetch expected stock
      const [prods, stock] = await Promise.all([
        fetch('/api/products').then(r => r.json()),
        fetch('/api/inventory/current').then(r => r.json()),
      ])

      const stockMap: Record<number, number> = {}
      stock.forEach((s: any) => { stockMap[s.id] = s.currentStock })

      const validEntries: any[] = []
      prods.forEach((p: any) => {
        p.sizes.forEach((s: any) => {
          const expectedStock = stockMap[s.id] ?? 0
          if (expectedStock > 0) {
            validEntries.push({
              productSizeId: s.id,
              cases: Math.floor(expectedStock / s.bottlesPerCase),
              bottles: expectedStock % s.bottlesPerCase,
            })
          }
        })
      })

      // 2. Submit Closing Stock (Expected == Actual, variance 0)
      const res = await fetch('/api/inventory/close-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: validEntries }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to close day')

      // 3. Auto-Carry Forward for tomorrow's opening logic
      const cfRes = await fetch('/api/inventory/carry-forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      if (!cfRes.ok) throw new Error('Closing stock worked, but failed to auto carry-forward for tomorrow.')

      setSavedCount(data.closingEntriesSaved)
      setStep('result')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5 max-w-4xl mx-auto mt-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-900 transition-colors">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
        </button>
        <h1 className="text-3xl font-black text-slate-800 tracking-tight">
          {step === 'summary' ? '1-Click End of Day' : 'Day Closed'}
        </h1>
      </div>

      {step === 'summary' && summary && (
        <div className="space-y-6">
          <div className="bg-white border text-center border-slate-200 rounded-2xl p-8 shadow-sm">
            <h2 className="text-lg font-bold text-slate-600 mb-6 uppercase tracking-wider">
              Today&apos;s Financials — {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
            </h2>
            <div className="grid grid-cols-3 gap-6">
              <div>
                <div className="text-5xl font-black text-blue-600">{summary.todaySales.bills}</div>
                <div className="text-sm text-slate-500 font-bold mt-2 uppercase tracking-wide">Total Bills</div>
              </div>
              <div className="border-l border-slate-100">
                <div className="text-5xl font-black text-emerald-600">{summary.todaySales.bottles}</div>
                <div className="text-sm text-slate-500 font-bold mt-2 uppercase tracking-wide">Bottles Sold</div>
              </div>
              <div className="border-l border-slate-100">
                <div className="text-5xl font-black text-slate-800">{fmt(summary.todaySales.totalAmount)}</div>
                <div className="text-sm text-slate-500 font-bold mt-2 uppercase tracking-wide">Gross Revenue</div>
              </div>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 p-6 rounded-2xl">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-2">
              <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
              Continuous Ledger Snapshot
            </h3>
            <p className="text-slate-600 text-sm leading-relaxed">
              Clicking below will automatically lock the mathematical state of your software (Opening + Indents - Sales). It calculates the Final Closing Stock for today and duplicates it as the Initial Opening Stock for tomorrow.
            </p>
          </div>

          {summary.currentSession?.hasClosing ? (
            <div className="p-4 bg-slate-100 border border-slate-300 rounded-xl text-slate-600 font-medium text-center">
              The day has already been closed.
            </div>
          ) : (
            <div className="flex justify-center pt-4">
              <button onClick={autoSubmitClosingStock} disabled={saving}
                className="w-full max-w-md px-8 py-5 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition shadow-xl disabled:opacity-50 text-xl flex flex-col items-center justify-center gap-1">
                {saving ? (
                  <span>Processing Ledger...</span>
                ) : (
                  <>
                    <span>Save Ledger & Open Tomorrow</span>
                    <span className="text-slate-400 text-xs tracking-widest uppercase font-semibold">Continuous Rollover</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {step === 'result' && (
        <div className="space-y-6">
          <div className="p-8 bg-emerald-50 border border-emerald-200 rounded-3xl text-center shadow-sm">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>
            </div>
            <div className="text-emerald-900 font-black text-2xl tracking-tight mb-2">Master Ledger Closed!</div>
            <div className="text-emerald-700 font-medium text-lg">
              {savedCount} items were accurately snapshotted and carried forward to tomorrow's ledger.
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 max-w-lg mx-auto">
            <button onClick={() => router.push('/reports')}
              className="px-6 py-4 border border-slate-200 rounded-2xl text-slate-600 font-bold hover:bg-slate-50 transition w-full">
              Export Excel Sheets
            </button>
            <button onClick={() => router.push('/dashboard')}
              className="px-6 py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition w-full">
              Back to Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
