/**
 * Offline-first sync engine.
 *
 * Responsibilities:
 *  1. PULL  — fetch latest products, staff, and today's cash record from cloud
 *  2. PUSH  — upload pending sales, attendance, expenses, cash records to cloud
 *  3. Retry — exponential back-off, give up after MAX_ATTEMPTS (not discarded,
 *             just skipped until next manual trigger or app restart)
 *  4. Network watch — starts/stops based on connectivity
 *
 * All cloud communication is authenticated with a Bearer token (SYNC_TOKEN).
 * The token is set during first-run setup and stored in app_settings.
 */

import Database from 'better-sqlite3'
import {
  getDb, getSetting, setSetting, logSync,
  getPendingSales, markSaleSynced, markSaleFailed,
  getPendingAttendance, markAttendanceSynced,
  getPendingExpenses, markExpenseSynced,
  getPendingCashRecords, markCashSynced,
  upsertProducts, upsertStaff,
  getTodayCashRecord, upsertCashRecord,
  ProductRow, StaffRow,
} from './db'
import { BrowserWindow } from 'electron'

// ── Config ────────────────────────────────────────────────────────────────────
const PULL_INTERVAL_MS  = 5 * 60 * 1000  // every 5 minutes
const PUSH_INTERVAL_MS  = 30 * 1000       // every 30 seconds
const MAX_ATTEMPTS      = 5               // per record (marks as failed after)
const RETRY_BACKOFF     = [5, 15, 30, 60, 120]  // seconds

let pushTimer: ReturnType<typeof setInterval> | null = null
let pullTimer: ReturnType<typeof setInterval> | null = null
let isOnline = false
let isSyncing = false

// ── Network detection ─────────────────────────────────────────────────────────
export function startNetworkMonitor() {
  setInterval(checkConnectivity, 15_000)
  checkConnectivity()
}

async function checkConnectivity() {
  const db  = getDb()
  const url = getSetting(db, 'cloud_url')
  if (!url) return

  try {
    const res = await fetch(`${url}/api/sync/heartbeat`, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    })
    const wasOnline = isOnline
    isOnline = res.ok

    if (!wasOnline && isOnline) {
      console.log('[sync] Back online — triggering immediate sync')
      broadcastStatus('online')
      triggerPush()
      triggerPull()
    } else if (wasOnline && !isOnline) {
      console.log('[sync] Offline')
      broadcastStatus('offline')
    }
  } catch {
    if (isOnline) {
      isOnline = false
      broadcastStatus('offline')
    }
  }
}

export function startSyncTimers() {
  if (pushTimer) clearInterval(pushTimer)
  if (pullTimer) clearInterval(pullTimer)
  pushTimer = setInterval(() => { if (isOnline) triggerPush() }, PUSH_INTERVAL_MS)
  pullTimer = setInterval(() => { if (isOnline) triggerPull() }, PULL_INTERVAL_MS)
}

// ── Broadcast to renderer ─────────────────────────────────────────────────────
function broadcastStatus(event: string, data?: unknown) {
  const wins = BrowserWindow.getAllWindows()
  wins.forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send(`sync:${event}`, data)
    }
  })
}

// ── PULL ──────────────────────────────────────────────────────────────────────
export async function triggerPull() {
  const db = getDb()
  const url = getSetting(db, 'cloud_url')
  const token = getSetting(db, 'sync_token')
  if (!url || !token) return

  try {
    const res = await fetch(`${url}/api/sync/pull`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      console.error('[sync] Pull failed:', res.status)
      return
    }

    const data = await res.json() as {
      products: ProductRow[]
      staff: StaffRow[]
      cash_today: Record<string, unknown> | null
    }

    // Update local caches
    if (Array.isArray(data.products) && data.products.length > 0) {
      upsertProducts(db, data.products)
      logSync(db, 'pull', 'products', data.products.length, true)
    }
    if (Array.isArray(data.staff) && data.staff.length > 0) {
      upsertStaff(db, data.staff)
      logSync(db, 'pull', 'staff', data.staff.length, true)
    }

    // If cloud has a cash record for today, use it as opening for local
    if (data.cash_today) {
      const rec = getTodayCashRecord(db)
      if (!rec) {
        upsertCashRecord(db, {
          record_date: data.cash_today.recordDate as string,
          opening_register: Number(data.cash_today.openingRegister ?? 0),
          cash_sales: Number(data.cash_today.cashSales ?? 0),
          expenses: Number(data.cash_today.expenses ?? 0),
          cash_to_locker: Number(data.cash_today.cashToLocker ?? 0),
          closing_register: Number(data.cash_today.closingRegister ?? 0),
          card_sales: Number(data.cash_today.cardSales ?? 0),
          upi_sales: Number(data.cash_today.upiSales ?? 0),
          credit_sales: Number(data.cash_today.creditSales ?? 0),
          credit_collected: Number(data.cash_today.creditCollected ?? 0),
        })
      }
    }

    setSetting(db, 'last_pull_at', Date.now().toString())
    broadcastStatus('pull_complete', { products: data.products?.length, staff: data.staff?.length })
  } catch (e) {
    console.error('[sync] Pull error:', e)
    logSync(db, 'pull', 'all', 0, false, String(e))
  }
}

// ── PUSH ──────────────────────────────────────────────────────────────────────
export async function triggerPush() {
  if (isSyncing) return
  isSyncing = true

  const db = getDb()
  const url = getSetting(db, 'cloud_url')
  const token = getSetting(db, 'sync_token')

  if (!url || !token) {
    isSyncing = false
    return
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }

  try {
    await pushSales(db, url, headers)
    await pushAttendance(db, url, headers)
    await pushExpenses(db, url, headers)
    await pushCashRecords(db, url, headers)
    setSetting(db, 'last_push_at', Date.now().toString())
    broadcastStatus('push_complete')
  } catch (e) {
    console.error('[sync] Push error:', e)
  } finally {
    isSyncing = false
  }
}

async function pushSales(db: Database.Database, url: string, headers: Record<string, string>) {
  const pending = getPendingSales(db)
  if (pending.length === 0) return

  try {
    const res = await fetch(`${url}/api/sync/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'sales', records: pending }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[sync] Push sales failed:', res.status, err)
      logSync(db, 'push', 'sales', pending.length, false, `HTTP ${res.status}: ${err}`)
      return
    }

    const result = await res.json() as { acks: { local_id: string; server_id: number; error?: string }[] }

    for (const ack of result.acks) {
      if (ack.server_id) {
        markSaleSynced(db, ack.local_id, ack.server_id)
      } else if (ack.error) {
        // Server rejected this specific record (e.g. out of stock)
        // We mark it failed but keep it visible in UI for review
        markSaleFailed(db, ack.local_id, ack.error)
      }
    }

    logSync(db, 'push', 'sales', pending.length, true)
    broadcastStatus('sales_synced', { count: pending.length })
  } catch (e) {
    console.error('[sync] Push sales error:', e)
    logSync(db, 'push', 'sales', pending.length, false, String(e))
  }
}

async function pushAttendance(db: Database.Database, url: string, headers: Record<string, string>) {
  const pending = getPendingAttendance(db)
  if (pending.length === 0) return

  try {
    const res = await fetch(`${url}/api/sync/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'attendance', records: pending }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) return

    const result = await res.json() as { acks: { local_id: string; server_id: number }[] }
    for (const ack of result.acks) {
      if (ack.server_id) markAttendanceSynced(db, ack.local_id, ack.server_id)
    }
    logSync(db, 'push', 'attendance', pending.length, true)
  } catch (e) {
    console.error('[sync] Push attendance error:', e)
  }
}

async function pushExpenses(db: Database.Database, url: string, headers: Record<string, string>) {
  const pending = getPendingExpenses(db)
  if (pending.length === 0) return

  try {
    const res = await fetch(`${url}/api/sync/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'expenses', records: pending }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) return

    const result = await res.json() as { acks: { local_id: string; server_id: number }[] }
    for (const ack of result.acks) {
      if (ack.server_id) markExpenseSynced(db, ack.local_id, ack.server_id)
    }
    logSync(db, 'push', 'expenses', pending.length, true)
  } catch (e) {
    console.error('[sync] Push expenses error:', e)
  }
}

async function pushCashRecords(db: Database.Database, url: string, headers: Record<string, string>) {
  const pending = getPendingCashRecords(db)
  if (pending.length === 0) return

  try {
    const res = await fetch(`${url}/api/sync/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'cash', records: pending }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) return

    const result = await res.json() as { acks: { local_id: string; server_id: number }[] }
    for (const ack of result.acks) {
      if (ack.server_id) markCashSynced(db, ack.local_id, ack.server_id)
    }
    logSync(db, 'push', 'cash', pending.length, true)
  } catch (e) {
    console.error('[sync] Push cash error:', e)
  }
}

// ── Public helpers ────────────────────────────────────────────────────────────
export function getSyncStatus() {
  const db = getDb()
  const lastPull = getSetting(db, 'last_pull_at')
  const lastPush = getSetting(db, 'last_push_at')
  return {
    isOnline,
    isSyncing,
    lastPullAt: lastPull ? parseInt(lastPull) : null,
    lastPushAt: lastPush ? parseInt(lastPush) : null,
    pendingSales: getPendingSales(db).length,
    pendingAttendance: getPendingAttendance(db).length,
    pendingExpenses: getPendingExpenses(db).length,
  }
}

export function getIsOnline(): boolean {
  return isOnline
}
