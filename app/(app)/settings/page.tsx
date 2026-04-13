'use client'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'

export default function SettingsPage() {
  const { data: session } = useSession()
  const user = session?.user as { id?: string; name?: string; role?: string } | undefined
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(setSettings)
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (user?.role !== 'ADMIN') return (
    <div className="p-8 text-center text-gray-400">
      <div className="text-4xl mb-3">🔒</div><p>Admin access required</p>
    </div>
  )

  const field = (label: string, key: string, type = 'text', hint = '') => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} value={settings[key] ?? ''} onChange={e => setSettings({...settings, [key]: e.target.value})}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  )

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <button onClick={() => window.location.href='/settings/barcodes'}
          className="px-4 py-2 bg-slate-800 text-white text-xs font-bold rounded-lg hover:bg-slate-700 transition-all uppercase tracking-widest shadow-lg">
          Master Barcode Importer
        </button>
      </div>

      {saved && <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 font-medium"> Settings saved!</div>}

      <form onSubmit={save} className="space-y-6">
        {/* Shop Info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-800">🏪 Shop Information</h2>
          {field('Shop Name', 'shop_name')}
          {field('License ID', 'license_id')}
          {field('Owner Name', 'owner_name')}
        </div>

        {/* Variance Thresholds */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-800"> Variance Thresholds</h2>
          {field('LOW Variance Threshold (bottles)', 'variance_low_threshold', 'number', 'Variances ≤ this value are marked LOW severity')}
          {field('HIGH Variance Threshold (bottles)', 'variance_high_threshold', 'number', 'Variances > this value are marked HIGH severity')}
        </div>

        {/* Stock Thresholds */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-800"> Stock Alerts</h2>
          {field('Low Stock Threshold (bottles)', 'low_stock_threshold', 'number', 'Products below this quantity will show as LOW on inventory')}
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
          <strong>Login Credentials (from database):</strong><br />
          Admin: email + password via Admin Login tab<br />
          Staff: 4-digit PIN via Staff PIN tab<br />
          <br />
          To change staff PINs, go to the Staff Management page.
        </div>

        <button type="submit" disabled={saving}
          className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  )
}
