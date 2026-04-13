/**
 * Electron main process — entry point for the Windows POS app.
 *
 * Responsibilities:
 *  - Create and manage the browser window
 *  - Register IPC handlers (database + sync operations)
 *  - Initialize the sync engine
 *  - Manage auto-updates via electron-updater
 *  - Configure auto-start on Windows login
 */

import { app, BrowserWindow, ipcMain, dialog, shell, powerSaveBlocker } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'path'
import {
  getDb, getSetting, setSetting,
  getProducts, getProductByBarcode,
  getStaff,
  insertSale, getTodaySales, getTodayTotals,
  checkInStaff, checkOutStaff, getAttendanceForDate, getAttendanceForStaffToday,
  insertExpense, getTodayExpenses,
  getTodayCashRecord, upsertCashRecord,
  todayStr,
} from './db'
import {
  startNetworkMonitor, startSyncTimers,
  triggerPull, triggerPush, getSyncStatus,
} from './sync'

// ── Resolve renderer path ─────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// ── Single instance lock ──────────────────────────────────────────────────────
// Prevents two POS windows opening simultaneously
const lock = app.requestSingleInstanceLock()
if (!lock) {
  app.quit()
  process.exit(0)
}

let mainWindow: BrowserWindow | null = null

// ── Create window ─────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    frame: true,
    autoHideMenuBar: true,         // hide menu bar in production
    backgroundColor: '#0f172a',   // slate-900 — shows before renderer loads
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,      // required for security
      nodeIntegration: false,      // renderer cannot access Node
      sandbox: false,              // preload needs require
    },
    title: 'Mahavishnu Wines POS',
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Prevent the screen from sleeping during POS operation
  powerSaveBlocker.start('prevent-display-sleep')

  mainWindow.on('closed', () => { mainWindow = null })

  // Open external links in the system browser, not in the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// ── Second instance ───────────────────────────────────────────────────────────
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// ── App ready ─────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Initialize database (creates schema on first run)
  try {
    getDb()
    console.log('[main] Database initialized')
  } catch (e) {
    console.error('[main] DB init failed:', e)
    dialog.showErrorBox('Database Error', `Failed to initialize local database.\n${e}`)
    app.quit()
    return
  }

  createWindow()

  // Start sync services
  startNetworkMonitor()
  startSyncTimers()

  // Do an immediate pull on startup
  setTimeout(() => triggerPull(), 3_000)

  // Auto-updater (production only)
  if (!isDev) {
    configureAutoUpdater()
  }
})

app.on('window-all-closed', () => {
  // On Windows, quit the app when all windows are closed
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ── Auto-updater ──────────────────────────────────────────────────────────────
function configureAutoUpdater() {
  autoUpdater.autoDownload = true          // download silently in background
  autoUpdater.autoInstallOnAppQuit = true  // install on next quit

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] Update available:', info.version)
    mainWindow?.webContents.send('updater:available', info)
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] Update downloaded:', info.version)
    // Show a notification in the UI
    mainWindow?.webContents.send('updater:downloaded', info)
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err)
  })

  // Check for updates every 2 hours
  autoUpdater.checkForUpdates().catch(console.error)
  setInterval(() => autoUpdater.checkForUpdates().catch(console.error), 2 * 60 * 60 * 1000)
}

// ── IPC Handlers — Database ───────────────────────────────────────────────────
ipcMain.handle('db:getProducts', () => {
  return getProducts(getDb())
})

ipcMain.handle('db:getProductByBarcode', (_, barcode: string) => {
  return getProductByBarcode(getDb(), barcode)
})

ipcMain.handle('db:getStaff', () => {
  return getStaff(getDb())
})

ipcMain.handle('db:insertSale', (_, input) => {
  try {
    const sale = insertSale(getDb(), input)
    // Immediately try to push if online
    triggerPush()
    return { ok: true, sale }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('db:getTodaySales', () => {
  return getTodaySales(getDb())
})

ipcMain.handle('db:getTodayTotals', () => {
  return getTodayTotals(getDb())
})

ipcMain.handle('db:checkIn', (_, staffId: number, staffName: string) => {
  try {
    const record = checkInStaff(getDb(), staffId, staffName)
    triggerPush()
    return { ok: true, record }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('db:checkOut', (_, staffId: number) => {
  try {
    const record = checkOutStaff(getDb(), staffId)
    triggerPush()
    return { ok: true, record }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('db:getTodayAttendance', () => {
  return getAttendanceForDate(getDb(), todayStr())
})

ipcMain.handle('db:getAttendanceForStaffToday', (_, staffId: number) => {
  return getAttendanceForStaffToday(getDb(), staffId)
})

ipcMain.handle('db:insertExpense', (_, input) => {
  try {
    const expense = insertExpense(getDb(), input)
    triggerPush()
    return { ok: true, expense }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('db:getTodayExpenses', () => {
  return getTodayExpenses(getDb())
})

ipcMain.handle('db:getTodayCashRecord', () => {
  return getTodayCashRecord(getDb())
})

ipcMain.handle('db:upsertCashRecord', (_, data) => {
  try {
    const record = upsertCashRecord(getDb(), data)
    triggerPush()
    return { ok: true, record }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// ── IPC Handlers — Sync ───────────────────────────────────────────────────────
ipcMain.handle('sync:getStatus', () => {
  return getSyncStatus()
})

ipcMain.handle('sync:trigger', async () => {
  await triggerPull()
  await triggerPush()
  return getSyncStatus()
})

// ── IPC Handlers — Settings ───────────────────────────────────────────────────
ipcMain.handle('settings:get', () => {
  const db = getDb()
  return {
    cloud_url:  getSetting(db, 'cloud_url')  ?? '',
    sync_token: getSetting(db, 'sync_token') ?? '',
    outlet_name: getSetting(db, 'outlet_name') ?? 'Mahavishnu Wines',
  }
})

ipcMain.handle('settings:save', (_, data: { cloud_url?: string; sync_token?: string; outlet_name?: string }) => {
  const db = getDb()
  if (data.cloud_url)    setSetting(db, 'cloud_url',    data.cloud_url)
  if (data.sync_token)   setSetting(db, 'sync_token',   data.sync_token)
  if (data.outlet_name)  setSetting(db, 'outlet_name',  data.outlet_name)
  // Trigger a pull with new settings
  setTimeout(() => triggerPull(), 500)
  return { ok: true }
})

// ── IPC Handlers — Updater ────────────────────────────────────────────────────
ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall()
})

// ── IPC Handlers — App ────────────────────────────────────────────────────────
ipcMain.handle('app:getVersion', () => {
  return app.getVersion()
})

// ── Windows auto-start ────────────────────────────────────────────────────────
// In production, register the app to start with Windows login
if (!isDev && process.platform === 'win32') {
  app.setLoginItemSettings({
    openAtLogin: true,
    name: 'Mahavishnu Wines POS',
    args: ['--autostart'],
  })
}
