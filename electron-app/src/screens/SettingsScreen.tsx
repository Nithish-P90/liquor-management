import { useState, useEffect } from 'react'
import { Save, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react'

type Props = {
  onSaved?: () => void
}

export default function SettingsScreen({ onSaved }: Props) {
  const [cloudUrl, setCloudUrl]   = useState('')
  const [syncToken, setSyncToken] = useState('')
  const [outletName, setOutletName] = useState('Mahavishnu Wines')
  const [isSaving, setIsSaving]   = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [version, setVersion]     = useState('')

  useEffect(() => {
    window.posAPI.getSettings().then(s => {
      setCloudUrl(s.cloud_url)
      setSyncToken(s.sync_token)
      setOutletName(s.outlet_name || 'Mahavishnu Wines')
    })
    window.posAPI.getVersion().then(setVersion)
  }, [])

  const handleTest = async () => {
    if (!cloudUrl || !syncToken) {
      setTestResult({ ok: false, msg: 'Enter both URL and token first' })
      return
    }
    setIsTesting(true)
    setTestResult(null)
    try {
      const res = await fetch(`${cloudUrl}/api/sync/heartbeat`, {
        headers: { Authorization: `Bearer ${syncToken}` },
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        setTestResult({ ok: true, msg: 'Connected! Cloud is reachable.' })
      } else {
        setTestResult({ ok: false, msg: `Server returned ${res.status}. Check token.` })
      }
    } catch (e) {
      setTestResult({ ok: false, msg: `Cannot reach ${cloudUrl}. Check URL.` })
    } finally {
      setIsTesting(false)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    await window.posAPI.saveSettings({
      cloud_url: cloudUrl.replace(/\/$/, ''), // strip trailing slash
      sync_token: syncToken,
      outlet_name: outletName,
    })
    setIsSaving(false)
    onSaved?.()
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-900 p-6 scrollbar-thin">
      <div className="max-w-lg mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-200">Settings</h1>
          <p className="text-sm text-slate-500">Configure cloud connection for data sync</p>
        </div>

        {/* Cloud connection */}
        <div className="bg-slate-800 rounded-xl p-4 space-y-4">
          <h2 className="text-sm font-semibold text-slate-300">Cloud Connection</h2>

          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Cloud URL</label>
            <input
              type="url"
              value={cloudUrl}
              onChange={e => setCloudUrl(e.target.value)}
              placeholder="https://your-app.vercel.app"
              className="w-full bg-slate-700 text-slate-200 rounded px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="text-xs text-slate-500 mt-1">The URL of your Next.js app deployed on Vercel</p>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Sync Token</label>
            <input
              type="password"
              value={syncToken}
              onChange={e => setSyncToken(e.target.value)}
              placeholder="Your secret sync token"
              className="w-full bg-slate-700 text-slate-200 rounded px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="text-xs text-slate-500 mt-1">Set SYNC_TOKEN in your Vercel environment variables</p>
          </div>

          <button
            onClick={handleTest}
            disabled={isTesting}
            className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 transition-colors"
          >
            <ExternalLink size={13} />
            {isTesting ? 'Testing...' : 'Test connection'}
          </button>

          {testResult && (
            <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2
              ${testResult.ok ? 'bg-emerald-900/40 text-emerald-300' : 'bg-red-900/40 text-red-300'}`}>
              {testResult.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
              {testResult.msg}
            </div>
          )}
        </div>

        {/* Outlet info */}
        <div className="bg-slate-800 rounded-xl p-4 space-y-4">
          <h2 className="text-sm font-semibold text-slate-300">Outlet Information</h2>
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Outlet Name</label>
            <input
              type="text"
              value={outletName}
              onChange={e => setOutletName(e.target.value)}
              className="w-full bg-slate-700 text-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={isSaving || !cloudUrl || !syncToken}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
        >
          <Save size={14} />
          {isSaving ? 'Saving...' : 'Save & Connect'}
        </button>

        {/* App info */}
        <div className="text-xs text-slate-600 text-center space-y-1">
          <p>Mahavishnu Wines POS {version && `v${version}`}</p>
          <p>Auto-updates are enabled. App restarts to apply updates.</p>
        </div>
      </div>
    </div>
  )
}
