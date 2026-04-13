import { useState, useEffect, useCallback } from 'react'
import { ShoppingCart, Clock, DollarSign, Settings, RefreshCw, Wifi, WifiOff, AlertTriangle } from 'lucide-react'
import POS from './screens/POS'
import Attendance from './screens/Attendance'
import Cash from './screens/Cash'
import SettingsScreen from './screens/SettingsScreen'
import type { SyncStatus } from './types'

type Screen = 'pos' | 'attendance' | 'cash' | 'settings'

export default function App() {
  const [screen, setScreen] = useState<Screen>('pos')
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [version, setVersion] = useState('')
  const [settingsConfigured, setSettingsConfigured] = useState(true)
  const [updateReady, setUpdateReady] = useState(false)

  // Load sync status
  const refreshSyncStatus = useCallback(async () => {
    const status = await window.posAPI.getSyncStatus()
    setSyncStatus(status)
  }, [])

  useEffect(() => {
    refreshSyncStatus()
    window.posAPI.getVersion().then(setVersion)

    // Check if settings are configured
    window.posAPI.getSettings().then(s => {
      setSettingsConfigured(Boolean(s.cloud_url && s.sync_token))
      if (!s.cloud_url || !s.sync_token) setScreen('settings')
    })

    // Poll sync status every 10s
    const interval = setInterval(refreshSyncStatus, 10_000)

    // Listen for sync events from main process
    const unsub = window.posAPI.onSyncEvent((event) => {
      refreshSyncStatus()
      if (event === 'online' || event === 'push_complete' || event === 'pull_complete') {
        setIsSyncing(false)
      }
    })

    // Listen for auto-updater events
    const unsubUpdater = window.posAPI.onUpdaterEvent((event) => {
      if (event === 'downloaded') setUpdateReady(true)
    })

    return () => {
      clearInterval(interval)
      unsub()
      unsubUpdater()
    }
  }, [refreshSyncStatus])

  const handleManualSync = async () => {
    setIsSyncing(true)
    const status = await window.posAPI.triggerSync()
    setSyncStatus(status)
    setIsSyncing(false)
  }

  const pendingCount = syncStatus
    ? syncStatus.pendingSales + syncStatus.pendingAttendance + syncStatus.pendingExpenses
    : 0

  const navItems: { id: Screen; label: string; icon: React.ReactNode }[] = [
    { id: 'pos', label: 'POS', icon: <ShoppingCart size={20} /> },
    { id: 'attendance', label: 'Attendance', icon: <Clock size={20} /> },
    { id: 'cash', label: 'Cash Register', icon: <DollarSign size={20} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={20} /> },
  ]

  return (
    <div className="flex h-screen bg-slate-900 text-slate-100 overflow-hidden">
      {/* Sidebar navigation */}
      <aside className="w-16 bg-slate-800 border-r border-slate-700 flex flex-col items-center py-4 gap-1 flex-shrink-0">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => setScreen(item.id)}
            title={item.label}
            className={`
              w-12 h-12 flex flex-col items-center justify-center rounded-lg text-xs gap-1
              transition-colors duration-150
              ${screen === item.id
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:bg-slate-700 hover:text-slate-200'}
            `}
          >
            {item.icon}
          </button>
        ))}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Sync status indicator */}
        <div className="flex flex-col items-center gap-2 pb-2">
          {/* Pending records badge */}
          {pendingCount > 0 && (
            <div className="w-6 h-6 rounded-full bg-amber-500 text-black text-xs flex items-center justify-center font-bold"
                 title={`${pendingCount} records pending sync`}>
              {pendingCount > 99 ? '99+' : pendingCount}
            </div>
          )}

          {/* Online/offline indicator */}
          <button
            onClick={handleManualSync}
            disabled={isSyncing}
            title={syncStatus?.isOnline ? 'Online — click to sync now' : 'Offline — data saved locally'}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors"
          >
            {isSyncing ? (
              <RefreshCw size={18} className="animate-spin text-indigo-400" />
            ) : syncStatus?.isOnline ? (
              <Wifi size={18} className="text-emerald-400" />
            ) : (
              <WifiOff size={18} className="text-slate-500" />
            )}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Offline banner */}
        {syncStatus && !syncStatus.isOnline && (
          <div className="bg-amber-900/50 border-b border-amber-700/50 px-4 py-2 flex items-center gap-2 text-amber-200 text-sm flex-shrink-0">
            <WifiOff size={14} />
            <span>Offline — all transactions are saved locally and will sync automatically when connection is restored</span>
            {pendingCount > 0 && (
              <span className="ml-auto font-medium">{pendingCount} pending sync</span>
            )}
          </div>
        )}

        {/* Settings not configured warning */}
        {!settingsConfigured && screen !== 'settings' && (
          <div className="bg-red-900/50 border-b border-red-700/50 px-4 py-2 flex items-center gap-2 text-red-200 text-sm flex-shrink-0">
            <AlertTriangle size={14} />
            <span>Cloud sync not configured. Go to Settings to connect.</span>
            <button
              onClick={() => setScreen('settings')}
              className="ml-auto underline text-red-300 hover:text-white"
            >
              Open Settings
            </button>
          </div>
        )}

        {/* Screen content */}
        <div className="flex-1 overflow-hidden">
          {screen === 'pos'        && <POS />}
          {screen === 'attendance' && <Attendance />}
          {screen === 'cash'       && <Cash />}
          {screen === 'settings'   && (
            <SettingsScreen
              onSaved={() => {
                setSettingsConfigured(true)
                setScreen('pos')
                handleManualSync()
              }}
            />
          )}
        </div>

        {/* Update ready banner */}
        {updateReady && (
          <div className="bg-indigo-900/80 border-t border-indigo-600/50 px-4 py-2 flex items-center gap-3 text-indigo-100 text-sm flex-shrink-0">
            <RefreshCw size={14} />
            <span>Update downloaded and ready to install.</span>
            <button
              onClick={() => window.posAPI.installUpdate()}
              className="ml-auto bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white px-4 py-1.5 rounded-md font-medium transition-colors"
            >
              Restart to update
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="bg-slate-800/50 border-t border-slate-700/50 px-4 py-1 flex items-center justify-between text-xs text-slate-500 flex-shrink-0">
          <span>Mahavishnu Wines POS {version && `v${version}`}</span>
          <span>
            {syncStatus?.lastPushAt
              ? `Last sync: ${new Date(syncStatus.lastPushAt).toLocaleTimeString()}`
              : 'Not synced yet'}
          </span>
        </div>
      </main>
    </div>
  )
}
