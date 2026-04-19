'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'

type RechartsModule = typeof import('recharts')
type BarChartType = RechartsModule['BarChart']
type BarType = RechartsModule['Bar']
type XAxisType = RechartsModule['XAxis']
type YAxisType = RechartsModule['YAxis']
type CartesianGridType = RechartsModule['CartesianGrid']
type TooltipType = RechartsModule['Tooltip']
type ResponsiveContainerType = RechartsModule['ResponsiveContainer']

const BarChart = dynamic(() => import('recharts').then(m => m.BarChart), { ssr: false }) as unknown as BarChartType
const Bar = dynamic(() => import('recharts').then(m => m.Bar), { ssr: false }) as unknown as BarType
const XAxis = dynamic(() => import('recharts').then(m => m.XAxis), { ssr: false }) as unknown as XAxisType
const YAxis = dynamic(() => import('recharts').then(m => m.YAxis), { ssr: false }) as unknown as YAxisType
const CartesianGrid = dynamic(() => import('recharts').then(m => m.CartesianGrid), { ssr: false }) as unknown as CartesianGridType
const Tooltip = dynamic(() => import('recharts').then(m => m.Tooltip), { ssr: false }) as unknown as TooltipType
const ResponsiveContainer = dynamic(() => import('recharts').then(m => m.ResponsiveContainer), { ssr: false }) as unknown as ResponsiveContainerType

type ClerkBillingRow = { staffId: number; name: string; bills: number; bottles: number; amount: number }

type TopSellerRow = { name: string; sizeMl: number; bottles: number; amount: number; txCount: number }

type DashboardData = {
  todaySales: { total: number; bottles: number; cash: number; card: number; upi: number }
  miscSaleTotal: number
  alerts: { total: number; high: number }
  pendingIndents: number
  clerkBilling: ClerkBillingRow[]
  weeklySales: { date: string; amount: number }[]
  topSellers: TopSellerRow[]
  topSellersWeek: TopSellerRow[]
  topSellersMonth: TopSellerRow[]
  recentAlerts: { id: number; product: string; sizeMl: number; variance: number; date: string; severity: string }[]
}

type Notification = {
  id: number
  type: string
  title: string
  body: string
  read: boolean
  createdAt: string
}

function rupee(n: number) {
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

export default function DashboardPage() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [leaderTab, setLeaderTab] = useState<'today' | 'week' | 'month'>('week')
  const [leaderGroupBy, setLeaderGroupBy] = useState<'product' | 'size'>('product')

  useEffect(() => {
    fetch('/api/reports/dashboard').then(r => r.json()).then(setData)
    fetch('/api/notifications').then(r => r.json()).then(setNotifications)
  }, [])

  async function markRead(ids: number[]) {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    setNotifications(prev => prev.map(n => ids.includes(n.id) ? { ...n, read: true } : n))
  }

  const unreadNotifications = notifications.filter(n => !n.read)

  if (!data) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const today = data.todaySales

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* Today's stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Today's Liquor Revenue" value={rupee(today.total)} sub={`${today.bottles} bottles sold`} accent="blue" />
        <StatCard label="Cash" value={rupee(Number(today.cash))} sub="Counter collections" accent="emerald" />
        <StatCard label="Card" value={rupee(Number(today.card))} sub="Card payments" accent="violet" />
        <StatCard label="UPI" value={rupee(Number(today.upi))} sub="Digital payments" accent="orange" />
        <StatCard label="Misc Sale (Separate)" value={rupee(data.miscSaleTotal)} sub="Not part of liquor revenue" accent="sky" />
      </div>

      {/* Notifications (price drops, system alerts) */}
      {unreadNotifications.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <h2 className="text-sm font-bold text-slate-700">Notifications</h2>
              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-bold rounded-full">
                {unreadNotifications.length} unread
              </span>
            </div>
            <button
              onClick={() => markRead(unreadNotifications.map(n => n.id))}
              className="text-xs text-slate-400 hover:text-slate-600 font-medium"
            >
              Mark all read
            </button>
          </div>
          <div className="space-y-2">
            {unreadNotifications.map(n => (
              <div key={n.id} className={`flex items-start gap-3 p-3 rounded-lg border ${
                n.type === 'PRICE_DECREASE' ? 'bg-amber-50 border-amber-100' : 'bg-blue-50 border-blue-100'
              }`}>
                <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                  n.type === 'PRICE_DECREASE' ? 'bg-amber-500' : 'bg-blue-500'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{n.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{n.body}</p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {new Date(n.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })} {new Date(n.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <button onClick={() => markRead([n.id])} className="text-slate-300 hover:text-slate-500 text-xs flex-shrink-0">
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts + top sellers */}
      <div className="grid grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Sales — Last 7 Days</h2>
          {data.weeklySales.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.weeklySales} barSize={24}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickFormatter={(d: unknown) => new Date(String(d)).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })}
                  axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickFormatter={(v: unknown) => `₹${(Number(v) / 1000).toFixed(0)}k`}
                  axisLine={false} tickLine={false} width={40} />
                <Tooltip formatter={(v: unknown) => [rupee(Number(v)), 'Revenue']}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Bar dataKey="amount" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-slate-300 text-sm">No sales data yet</div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-700">Top Sellers</h2>
            <div className="flex items-center gap-2">
              <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
                {(['product', 'size'] as const).map(g => (
                  <button key={g} onClick={() => setLeaderGroupBy(g)}
                    className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all ${leaderGroupBy === g ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                    {g === 'product' ? 'By Product' : 'By Size'}
                  </button>
                ))}
              </div>
              <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
                {(['today', 'week', 'month'] as const).map(t => (
                  <button key={t} onClick={() => setLeaderTab(t)}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-all ${leaderTab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                    {t === 'today' ? 'Today' : t === 'week' ? '7 Days' : '30 Days'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <Leaderboard
            rows={leaderTab === 'today' ? data.topSellers : leaderTab === 'week' ? data.topSellersWeek : data.topSellersMonth}
            groupBy={leaderGroupBy}
          />
        </div>
      </div>

      {/* Clerk Billing Today */}
      {data.clerkBilling?.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-700">Clerk Billing — Today</h2>
            <button onClick={() => router.push('/clerks')} className="text-xs text-blue-600 hover:underline font-medium">
              Full view
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-slate-100">
                {['Clerk', 'Bills', 'Bottles', 'Amount'].map(h => (
                  <th key={h} className="pb-2 text-xs font-semibold text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.clerkBilling.map(row => (
                <tr key={row.staffId}>
                  <td className="py-2 font-semibold text-slate-700">{row.name}</td>
                  <td className="py-2 text-slate-500">{row.bills}</td>
                  <td className="py-2 text-slate-500">{row.bottles}</td>
                  <td className="py-2 font-bold text-slate-800">{rupee(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Variance alerts table */}
      {data.recentAlerts.length > 0 && (
        <div className="bg-white border border-red-100 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-700">Stock Variance Alerts</h2>
            <button onClick={() => router.push('/alerts')} className="text-xs text-blue-600 hover:underline font-medium">
              View all
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-slate-100">
                {['Product', 'Size', 'Variance', 'Date', 'Severity'].map(h => (
                  <th key={h} className="pb-2 text-xs font-semibold text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.recentAlerts.map(a => (
                <tr key={a.id}>
                  <td className="py-2 font-medium text-slate-700">{a.product}</td>
                  <td className="py-2 text-slate-400">{a.sizeMl}ml</td>
                  <td className={`py-2 font-semibold ${a.variance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {a.variance > 0 ? '+' : ''}{a.variance} btls
                  </td>
                  <td className="py-2 text-slate-400">{new Date(a.date).toLocaleDateString('en-GB')}</td>
                  <td className="py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      a.severity === 'HIGH' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {a.severity}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-3">
        <button onClick={() => router.push('/inventory/closing')}
          className="p-4 bg-white border border-slate-200 rounded-xl text-left hover:border-blue-300 hover:bg-blue-50 transition-all">
          <div className="text-sm font-semibold text-slate-700">📦 Auto-Close Day</div>
          <div className="text-[11px] text-slate-400 mt-0.5">End day & carry forward</div>
        </button>
      </div>
    </div>
  )
}

type SizeGroup = { sizeMl: number; bottles: number; amount: number; txCount: number; productCount: number }

function groupBySize(rows: TopSellerRow[]): SizeGroup[] {
  const map = new Map<number, SizeGroup>()
  for (const r of rows) {
    const existing = map.get(r.sizeMl)
    if (existing) {
      existing.bottles += r.bottles
      existing.amount += r.amount
      existing.txCount += r.txCount
      existing.productCount += 1
    } else {
      map.set(r.sizeMl, { sizeMl: r.sizeMl, bottles: r.bottles, amount: r.amount, txCount: r.txCount, productCount: 1 })
    }
  }
  return Array.from(map.values()).sort((a, b) => b.bottles - a.bottles)
}

const SIZE_BADGE_COLORS: Record<number, string> = {
  1:    'bg-slate-100 text-slate-600 border-slate-200',
  60:   'bg-red-100 text-red-700 border-red-200',
  90:   'bg-orange-100 text-orange-700 border-orange-200',
  180:  'bg-amber-100 text-amber-700 border-amber-200',
  200:  'bg-yellow-100 text-yellow-700 border-yellow-200',
  250:  'bg-lime-100 text-lime-700 border-lime-200',
  275:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  330:  'bg-teal-100 text-teal-700 border-teal-200',
  375:  'bg-cyan-100 text-cyan-700 border-cyan-200',
  500:  'bg-sky-100 text-sky-700 border-sky-200',
  600:  'bg-blue-100 text-blue-700 border-blue-200',
  650:  'bg-indigo-100 text-indigo-700 border-indigo-200',
  750:  'bg-violet-100 text-violet-700 border-violet-200',
  1000: 'bg-purple-100 text-purple-700 border-purple-200',
}

function sizeBadgeColor(sizeMl: number) {
  return SIZE_BADGE_COLORS[sizeMl] ?? 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200'
}

function Leaderboard({ rows, groupBy }: { rows: TopSellerRow[] | undefined; groupBy: 'product' | 'size' }) {
  if (!rows || rows.length === 0) {
    return <div className="h-48 flex items-center justify-center text-slate-300 text-sm">No sales data</div>
  }

  const medals = ['🥇', '🥈', '🥉']
  const rankColors = [
    'text-amber-500 bg-amber-50 border-amber-200',
    'text-slate-500 bg-slate-100 border-slate-200',
    'text-orange-500 bg-orange-50 border-orange-200',
  ]

  if (groupBy === 'size') {
    const groups = groupBySize(rows)
    const maxBottles = Math.max(...groups.map(g => g.bottles), 1)
    return (
      <div className="space-y-3">
        {groups.map((g, i) => (
          <div key={g.sizeMl}>
            <div className="flex items-center gap-3 mb-1">
              <div className={`w-7 h-7 flex-shrink-0 rounded-lg border flex items-center justify-center text-xs font-black ${
                i < 3 ? rankColors[i] : 'text-slate-300 bg-white border-slate-100'
              }`}>
                {i < 3 ? medals[i] : i + 1}
              </div>
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-black border ${sizeBadgeColor(g.sizeMl)}`}>
                  {g.sizeMl}ml
                </span>
                <p className="text-[11px] text-slate-400">{g.productCount} {g.productCount === 1 ? 'product' : 'products'}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 text-right">
                <div>
                  <p className="text-xs font-black text-slate-800">{g.bottles} <span className="font-normal text-slate-400">units</span></p>
                  <p className="text-[10px] text-slate-400">{g.txCount} {g.txCount === 1 ? 'bill' : 'bills'}</p>
                </div>
                <p className="text-xs font-bold text-slate-700 w-14 text-right">{rupee(g.amount)}</p>
              </div>
            </div>
            <div className="ml-10 h-1 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${i === 0 ? 'bg-amber-400' : i === 1 ? 'bg-slate-400' : i === 2 ? 'bg-orange-400' : 'bg-blue-300'}`}
                style={{ width: `${(g.bottles / maxBottles) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  const maxBottles = Math.max(...rows.map(r => r.bottles), 1)
  return (
    <div className="space-y-3">
      {rows.map((s, i) => (
        <div key={i}>
          <div className="flex items-center gap-3 mb-1">
            <div className={`w-7 h-7 flex-shrink-0 rounded-lg border flex items-center justify-center text-xs font-black ${
              i < 3 ? rankColors[i] : 'text-slate-300 bg-white border-slate-100'
            }`}>
              {i < 3 ? medals[i] : i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-bold text-slate-800 truncate leading-tight">{s.name}</p>
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border flex-shrink-0 ${sizeBadgeColor(s.sizeMl)}`}>
                  {s.sizeMl}ml
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0 text-right">
              <div>
                <p className="text-xs font-black text-slate-800">{s.bottles} <span className="font-normal text-slate-400">units</span></p>
                <p className="text-[10px] text-slate-400">{s.txCount} {s.txCount === 1 ? 'bill' : 'bills'}</p>
              </div>
              <p className="text-xs font-bold text-slate-700 w-14 text-right">{rupee(s.amount)}</p>
            </div>
          </div>
          <div className="ml-10 h-1 bg-slate-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${i === 0 ? 'bg-amber-400' : i === 1 ? 'bg-slate-400' : i === 2 ? 'bg-orange-400' : 'bg-blue-300'}`}
              style={{ width: `${(s.bottles / maxBottles) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  const styles: Record<string, { border: string; bg: string; label: string; dot: string }> = {
    blue:    { border: 'border-l-blue-500',    bg: 'bg-blue-50/40',    label: 'text-blue-600',    dot: 'bg-blue-500' },
    emerald: { border: 'border-l-emerald-500', bg: 'bg-emerald-50/40', label: 'text-emerald-600', dot: 'bg-emerald-500' },
    violet:  { border: 'border-l-violet-500',  bg: 'bg-violet-50/40',  label: 'text-violet-600',  dot: 'bg-violet-500' },
    amber:   { border: 'border-l-amber-500',   bg: 'bg-amber-50/40',   label: 'text-amber-600',   dot: 'bg-amber-500' },
    sky:     { border: 'border-l-cyan-500',     bg: 'bg-cyan-50/40',    label: 'text-cyan-600',    dot: 'bg-cyan-500' },
    orange:  { border: 'border-l-orange-500',   bg: 'bg-orange-50/40',  label: 'text-orange-600',  dot: 'bg-orange-500' },
  }
  const s = styles[accent] ?? styles.blue
  return (
    <div className={`${s.bg} border border-slate-200 border-l-4 ${s.border} rounded-xl p-5`}>
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
        <p className={`text-xs font-semibold uppercase tracking-wide ${s.label}`}>{label}</p>
      </div>
      <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
      <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
    </div>
  )
}

