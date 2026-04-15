/**
 * Preload script — runs in a privileged context between main and renderer.
 * Exposes a minimal, typed API surface to the React app via contextBridge.
 * Nothing from Node.js leaks into the renderer directly.
 */

import { contextBridge, ipcRenderer } from 'electron'

// Type the exposed API (matches window.posAPI in renderer)
contextBridge.exposeInMainWorld('posAPI', {
  // ── Products ──────────────────────────────────────────────────────────────
  getProducts: () => ipcRenderer.invoke('db:getProducts'),
  getProductByBarcode: (barcode: string) => ipcRenderer.invoke('db:getProductByBarcode', barcode),

  // ── Staff ─────────────────────────────────────────────────────────────────
  getStaff: () => ipcRenderer.invoke('db:getStaff'),

  // ── Sales ─────────────────────────────────────────────────────────────────
  insertSale: (input: unknown) => ipcRenderer.invoke('db:insertSale', input),
  getTodaySales: () => ipcRenderer.invoke('db:getTodaySales'),
  getTodayTotals: () => ipcRenderer.invoke('db:getTodayTotals'),

  // ── Attendance ────────────────────────────────────────────────────────────
  checkIn: (staffId: number, staffName: string) => ipcRenderer.invoke('db:checkIn', staffId, staffName),
  checkOut: (staffId: number) => ipcRenderer.invoke('db:checkOut', staffId),
  getTodayAttendance: () => ipcRenderer.invoke('db:getTodayAttendance'),
  getAttendanceForStaffToday: (staffId: number) => ipcRenderer.invoke('db:getAttendanceForStaffToday', staffId),

  // ── Expenses ──────────────────────────────────────────────────────────────
  insertExpense: (input: unknown) => ipcRenderer.invoke('db:insertExpense', input),
  getTodayExpenses: () => ipcRenderer.invoke('db:getTodayExpenses'),

  // ── Cash record ───────────────────────────────────────────────────────────
  getTodayCashRecord: () => ipcRenderer.invoke('db:getTodayCashRecord'),
  upsertCashRecord: (data: unknown) => ipcRenderer.invoke('db:upsertCashRecord', data),

  // ── Misc items ────────────────────────────────────────────────────────────
  getMiscItems: () => ipcRenderer.invoke('db:getMiscItems'),
  getMiscItemByBarcode: (barcode: string) => ipcRenderer.invoke('db:getMiscItemByBarcode', barcode),
  saveMiscItem: (item: unknown) => ipcRenderer.invoke('db:saveMiscItem', item),
  deleteMiscItem: (id: number) => ipcRenderer.invoke('db:deleteMiscItem', id),
  insertMiscSale: (input: unknown) => ipcRenderer.invoke('db:insertMiscSale', input),
  getMiscTotalsToday: () => ipcRenderer.invoke('db:getMiscTotalsToday'),

  // ── Sync ──────────────────────────────────────────────────────────────────
  getSyncStatus: () => ipcRenderer.invoke('sync:getStatus'),
  triggerSync: () => ipcRenderer.invoke('sync:trigger'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (data: unknown) => ipcRenderer.invoke('settings:save', data),

  // ── Events from main → renderer ───────────────────────────────────────────
  onSyncEvent: (callback: (event: string, data: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) => callback('online', data)
    const handler2 = (_: Electron.IpcRendererEvent, data: unknown) => callback('offline', data)
    const handler3 = (_: Electron.IpcRendererEvent, data: unknown) => callback('push_complete', data)
    const handler4 = (_: Electron.IpcRendererEvent, data: unknown) => callback('pull_complete', data)
    ipcRenderer.on('sync:online', handler)
    ipcRenderer.on('sync:offline', handler2)
    ipcRenderer.on('sync:push_complete', handler3)
    ipcRenderer.on('sync:pull_complete', handler4)
    return () => {
      ipcRenderer.off('sync:online', handler)
      ipcRenderer.off('sync:offline', handler2)
      ipcRenderer.off('sync:push_complete', handler3)
      ipcRenderer.off('sync:pull_complete', handler4)
    }
  },

  // ── Auto-updater events ───────────────────────────────────────────────────
  onUpdaterEvent: (callback: (event: 'available' | 'downloaded', info: unknown) => void) => {
    const h1 = (_: Electron.IpcRendererEvent, info: unknown) => callback('available', info)
    const h2 = (_: Electron.IpcRendererEvent, info: unknown) => callback('downloaded', info)
    ipcRenderer.on('updater:available', h1)
    ipcRenderer.on('updater:downloaded', h2)
    return () => {
      ipcRenderer.off('updater:available', h1)
      ipcRenderer.off('updater:downloaded', h2)
    }
  },
  installUpdate: () => ipcRenderer.invoke('updater:install'),

  // ── App version ───────────────────────────────────────────────────────────
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
})
