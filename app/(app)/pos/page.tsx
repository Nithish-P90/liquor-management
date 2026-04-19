'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'

// ── Transaction journal (localStorage crash recovery) ─────────────────────────
// Written BEFORE any API call. Cleared AFTER confirmed success.
// Survives browser crashes, tab closes, and partial network failures.
const JOURNAL_KEY = 'pos_tx_journal'

type TxJournal = {
  id: string           // nanoid-style unique key
  at: string           // ISO timestamp the cashier pressed Complete
  staffId: number
  clerkLabel: string
  payMode: string
  customerName: string | null
  total: number
  items: Array<{
    productSizeId: number
    name: string
    sizeMl: number
    qty: number
    sellingPrice: number
  }>
  splitCash?: number
  splitMethod?: string
  retries: number      // how many times we've attempted to resubmit
  status: 'pending' | 'dismissed'
}

function journalRead(): TxJournal[] {
  try { return JSON.parse(localStorage.getItem(JOURNAL_KEY) ?? '[]') } catch { return [] }
}
function journalWrite(tx: TxJournal) {
  const all = journalRead().filter(t => t.id !== tx.id)
  localStorage.setItem(JOURNAL_KEY, JSON.stringify([...all, tx]))
}
function journalClear(id: string) {
  const all = journalRead().filter(t => t.id !== id)
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(all))
}
function journalUpdate(id: string, patch: Partial<TxJournal>) {
  const all = journalRead().map(t => t.id === id ? { ...t, ...patch } : t)
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(all))
}
function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

// ── Types ─────────────────────────────────────────────────────────────────────
type ProductSize = {
  id: number; sizeMl: number; bottlesPerCase: number; mrp: number
  sellingPrice: number; barcode: string | null; currentStock: number
  product: { id: number; name: string; category: string; itemCode: string }
}
type CartItem = {
  productSizeId: number; name: string; sizeMl: number
  sellingPrice: number; qty: number; stock: number
}
type StaffMember = { id: number; name: string; active: boolean; role: string }
type ClerkOption = { key: string; label: string; staffId: number; kind: 'COUNTER' | 'SUPPLIER' }
type PayMode = 'CASH' | 'CARD' | 'UPI' | 'SPLIT' | 'PENDING'
type RecentBill = {
  id: string
  saleTime: string
  clerkName: string
  paymentMode: string
  quantityBottles: number
  totalAmount: number
  lines: number
  items: {
    saleId: number
    productSizeId: number
    productName: string
    sizeMl: number
    quantityBottles: number
    totalAmount: number
  }[]
}
type TodayMiscSales = {
  totalAmount: number
  items: number
  entries: number
}
type PendingBill = {
  id: number
  billRef: string
  createdAt: string
  customerName: string | null
  totalAmount: string
  staff: { id: number; name: string }
  items: Array<{
    id: number
    productSizeId: number
    quantityBottles: number
    sellingPrice: string
    totalAmount: string
    productSize: { sizeMl: number; product: { name: string } }
  }>
}
type VoidItem = { productSizeId: number; name: string; sizeMl: number; qty: number }
type MiscItem = { id: number; barcode: string | null; name: string; category: string; unit: string; price: number }
type MiscCartItem = { itemId: number; name: string; category: string; unit: string; price: number; qty: number }
type PosNetworkState = 'CHECKING' | 'LIVE' | 'CONNECTED' | 'RECONNECTING' | 'OFFLINE'
const CATS = ['ALL', 'BRANDY', 'WHISKY', 'RUM', 'VODKA', 'GIN', 'WINE', 'PREMIX', 'BEER', 'BEVERAGE', '__MISC__']

// ── Distinct colors for category pills ──────────────────────────────────────
const CAT_COLORS: Record<string, { active: string; inactive: string }> = {
  ALL:           { active: 'bg-slate-800 text-white shadow-sm',     inactive: 'bg-slate-100 text-slate-500 hover:bg-slate-200' },
  BRANDY:        { active: 'bg-amber-600 text-white shadow-sm',    inactive: 'bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200' },
  WHISKY:        { active: 'bg-yellow-600 text-white shadow-sm',   inactive: 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border border-yellow-200' },
  RUM:           { active: 'bg-orange-600 text-white shadow-sm',   inactive: 'bg-orange-50 text-orange-600 hover:bg-orange-100 border border-orange-200' },
  VODKA:         { active: 'bg-sky-600 text-white shadow-sm',      inactive: 'bg-sky-50 text-sky-600 hover:bg-sky-100 border border-sky-200' },
  GIN:           { active: 'bg-emerald-600 text-white shadow-sm',  inactive: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200' },
  WINE:          { active: 'bg-rose-600 text-white shadow-sm',     inactive: 'bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200' },
  PREMIX:        { active: 'bg-violet-600 text-white shadow-sm',   inactive: 'bg-violet-50 text-violet-600 hover:bg-violet-100 border border-violet-200' },
  BEER:          { active: 'bg-lime-600 text-white shadow-sm',     inactive: 'bg-lime-50 text-lime-700 hover:bg-lime-100 border border-lime-200' },
  BEVERAGE:      { active: 'bg-cyan-600 text-white shadow-sm',     inactive: 'bg-cyan-50 text-cyan-600 hover:bg-cyan-100 border border-cyan-200' },
  __MISC__:      { active: 'bg-cyan-600 text-white shadow-sm',     inactive: 'bg-cyan-50 text-cyan-700 hover:bg-cyan-100 border border-cyan-300' },
}

// ── Distinct colors for size filter pills ───────────────────────────────────
const SIZE_COLORS: Record<number, { active: string; inactive: string }> = {
  1:    { active: 'bg-slate-700 text-white',   inactive: 'bg-slate-50 text-slate-500 border border-slate-300' },
  60:   { active: 'bg-red-600 text-white',     inactive: 'bg-red-50 text-red-600 border border-red-200' },
  90:   { active: 'bg-orange-600 text-white',  inactive: 'bg-orange-50 text-orange-600 border border-orange-200' },
  180:  { active: 'bg-amber-600 text-white',   inactive: 'bg-amber-50 text-amber-700 border border-amber-200' },
  200:  { active: 'bg-yellow-600 text-white',  inactive: 'bg-yellow-50 text-yellow-700 border border-yellow-200' },
  250:  { active: 'bg-lime-600 text-white',    inactive: 'bg-lime-50 text-lime-700 border border-lime-200' },
  275:  { active: 'bg-emerald-600 text-white', inactive: 'bg-emerald-50 text-emerald-600 border border-emerald-200' },
  330:  { active: 'bg-teal-600 text-white',    inactive: 'bg-teal-50 text-teal-600 border border-teal-200' },
  375:  { active: 'bg-cyan-600 text-white',    inactive: 'bg-cyan-50 text-cyan-600 border border-cyan-200' },
  500:  { active: 'bg-sky-600 text-white',     inactive: 'bg-sky-50 text-sky-600 border border-sky-200' },
  600:  { active: 'bg-blue-600 text-white',    inactive: 'bg-blue-50 text-blue-600 border border-blue-200' },
  650:  { active: 'bg-indigo-600 text-white',  inactive: 'bg-indigo-50 text-indigo-600 border border-indigo-200' },
  750:  { active: 'bg-violet-600 text-white',  inactive: 'bg-violet-50 text-violet-600 border border-violet-200' },
  1000: { active: 'bg-purple-600 text-white',  inactive: 'bg-purple-50 text-purple-600 border border-purple-200' },
}
const DEFAULT_SIZE_COLOR = { active: 'bg-fuchsia-600 text-white', inactive: 'bg-fuchsia-50 text-fuchsia-600 border border-fuchsia-200' }

function fmt(n: number) { return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 }) }

function playBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(2500, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(3000, ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.04, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } catch (e) {
    console.error('Audio beep failed', e);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function POSPage() {
  const { data: session } = useSession()
  const user = session?.user as { id?: string; name?: string; role?: string } | undefined

  const [products, setProducts] = useState<ProductSize[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [recentBills, setRecentBills] = useState<RecentBill[]>([])
  const [todayMiscSales, setTodayMiscSales] = useState<TodayMiscSales>({ totalAmount: 0, items: 0, entries: 0 })
  const [pendingBills, setPendingBills] = useState<PendingBill[]>([])
  const [pendingCount, setPendingCount] = useState(0)

  const [category, setCategory] = useState('ALL')
  const [sizeFilter, setSizeFilter] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [miscItems, setMiscItems] = useState<MiscItem[]>([])
  const [miscCart, setMiscCart] = useState<MiscCartItem[]>([])
  const [miscCatFilter, setMiscCatFilter] = useState<string>('ALL')
  const [counterStaffId, setCounterStaffId] = useState<number | null>(null)
  const [activeClerkKey, setActiveClerkKey] = useState<string>('COUNTER')
  const [voidMode, setVoidMode] = useState(false)
  const [voidItems, setVoidItems] = useState<VoidItem[]>([])

  const [payMode, setPayMode] = useState<PayMode>('CASH')
  const [tendered, setTendered] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [splitCash, setSplitCash] = useState('')
  const [splitMethod, setSplitMethod] = useState<'UPI' | 'CARD'>('UPI')

  const [processing, setProcessing] = useState(false)
  const [voidProcessing, setVoidProcessing] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [showPayment, setShowPayment] = useState(false)
  const [tabsCollapsed, setTabsCollapsed] = useState(false)
  const [lastTxSuccessAt, setLastTxSuccessAt] = useState<number | null>(null)
  const [lastTxErrorAt, setLastTxErrorAt] = useState<number | null>(null)
  const [heartbeatOkAt, setHeartbeatOkAt] = useState<number | null>(null)
  const [lastHeartbeatAttemptAt, setLastHeartbeatAttemptAt] = useState<number | null>(null)
  const [heartbeatFails, setHeartbeatFails] = useState(0)
  const [heartbeatConsecutiveOk, setHeartbeatConsecutiveOk] = useState(0)
  const [browserOnline, setBrowserOnline] = useState<boolean>(true)

  // Pending bill settlement modal
  const [settleTarget, setSettleTarget] = useState<PendingBill | null>(null)
  const [settleMode, setSettleMode] = useState<'CASH' | 'CARD' | 'UPI'>('CASH')
  const [settling, setSettling] = useState(false)
  const [pendingVoidMode, setPendingVoidMode] = useState(false)
  const [pendingVoidItems, setPendingVoidItems] = useState<Set<number>>(new Set())

  // Tab picker (PENDING payment mode)
  // null = new tab, number = id of existing tab to append to
  const [selectedTabId, setSelectedTabId] = useState<number | null | 'NEW'>(null)
  const [newTabName, setNewTabName] = useState('')

  // Crash-recovery journal
  const [orphanedTx, setOrphanedTx] = useState<TxJournal[]>([])
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const scanRef = useRef<HTMLInputElement>(null)
  const barcodeBuffer = useRef('')
  const barcodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load Data ──────────────────────────────────────────────────────────────
  const loadMiscItems = useCallback(async () => {
    try {
      const res = await fetch('/api/misc-items')
      if (!res.ok) return
      const data: unknown = await res.json()
      setMiscItems(Array.isArray(data) ? data as MiscItem[] : [])
    } catch { /* ignore */ }
  }, [])

  const loadProducts = useCallback(async () => {
    try {
      const res = await fetch('/api/pos/products')
      if (!res.ok) {
        setProducts([])
        return
      }
      const data: unknown = await res.json()
      setProducts(Array.isArray(data) ? data as ProductSize[] : [])
    } catch {
      setProducts([])
    } finally { setLoading(false) }
  }, [])

  const loadRecent = useCallback(async () => {
    try {
      const res = await fetch('/api/pos/summary')
      if (!res.ok) {
        setRecentBills([])
        return
      }
      const d: unknown = await res.json()
      const recent = (d && typeof d === 'object' && 'recentBills' in d)
        ? (d as { recentBills?: unknown }).recentBills
        : undefined
      setRecentBills(Array.isArray(recent) ? recent.slice(0, 8) as RecentBill[] : [])

      const misc = (d && typeof d === 'object' && 'todayMiscSales' in d)
        ? (d as { todayMiscSales?: { totalAmount?: unknown; items?: unknown; entries?: unknown } }).todayMiscSales
        : undefined
      setTodayMiscSales({
        totalAmount: Number(misc?.totalAmount ?? 0),
        items: Number(misc?.items ?? 0),
        entries: Number(misc?.entries ?? 0),
      })
    } catch { /* ignore */ }
  }, [])

  const loadPending = useCallback(async () => {
    try {
      const res = await fetch('/api/pending-bills')
      if (!res.ok) {
        setPendingBills([])
        setPendingCount(0)
        return
      }
      const data: unknown = await res.json()
      const list = Array.isArray(data) ? data as PendingBill[] : []
      setPendingBills(list)
      setPendingCount(list.length)
    } catch { /* ignore */ }
  }, [])

  const clerkOptions = useMemo<ClerkOption[]>(() => {
    if (!counterStaffId) return []
    const suppliers = staff
      .filter(s => s.active && s.role === 'SUPPLIER')
      .map(s => ({ key: `SUPPLIER:${s.id}`, label: s.name, staffId: s.id, kind: 'SUPPLIER' as const }))
    return [
      { key: 'COUNTER', label: 'Counter', staffId: counterStaffId, kind: 'COUNTER' as const },
      ...suppliers,
    ]
  }, [counterStaffId, staff])

  const activeClerk = useMemo(
    () => clerkOptions.find(c => c.key === activeClerkKey) ?? clerkOptions[0] ?? null,
    [clerkOptions, activeClerkKey]
  )
  const topClerkOptions = useMemo(() => clerkOptions.slice(0, 5), [clerkOptions])

  const syncClerkFromTab = useCallback((tab: PendingBill | null | undefined) => {
    if (!tab?.staff?.id) return
    const matched = clerkOptions.find(option => option.staffId === tab.staff.id)
    if (matched && matched.key !== activeClerkKey) {
      setActiveClerkKey(matched.key)
    }
  }, [clerkOptions, activeClerkKey])

  useEffect(() => {
    if (typeof selectedTabId !== 'number') return
    const tab = pendingBills.find(pb => pb.id === selectedTabId)
    syncClerkFromTab(tab)
  }, [selectedTabId, pendingBills, syncClerkFromTab])

  // Check for orphaned journal entries on mount (crash recovery)
  useEffect(() => {
    const orphans = journalRead().filter(t => t.status === 'pending')
    if (orphans.length) setOrphanedTx(orphans)
  }, [])

  // Retry a journaled transaction
  async function retryJournaled(tx: TxJournal) {
    setRetryingId(tx.id)
    journalUpdate(tx.id, { retries: tx.retries + 1 })
    try {
      const billTimeIso = new Date().toISOString()
      const results: unknown[] = []
      for (const item of tx.items) {
        const prop = item.sellingPrice * item.qty / tx.total
        const body: Record<string, unknown> = {
          productSizeId: item.productSizeId, quantityBottles: item.qty,
          paymentMode: tx.payMode, scanMethod: 'MANUAL', staffId: tx.staffId,
          customerName: tx.customerName || null,
          saleTime: billTimeIso,
        }
        if (tx.payMode === 'SPLIT' && tx.splitCash != null) {
          const splitRem = Math.max(0, tx.total - tx.splitCash)
          body.cashAmount = +(tx.splitCash * prop).toFixed(2)
          body[tx.splitMethod === 'CARD' ? 'cardAmount' : 'upiAmount'] = +(splitRem * prop).toFixed(2)
        }
        const res = await fetch('/api/sales', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Sale failed') }
        results.push(await res.json())
      }
      if (results.some((r: unknown) => r && typeof r === 'object' && 'error' in r)) throw new Error('Partial failure')
      // Success — remove from journal and orphan list
      journalClear(tx.id)
      setOrphanedTx(prev => prev.filter(t => t.id !== tx.id))
      setLastTxSuccessAt(Date.now())
      setLastTxErrorAt(null)
      flash(`Recovered: ${fmt(tx.total)} posted successfully`, 'ok')
      loadProducts(); loadRecent()
    } catch (e: unknown) {
      flash(`Retry failed: ${e instanceof Error ? e.message : 'Unknown error'} — transaction still saved`, 'err')
      setLastTxErrorAt(Date.now())
      // Update retry count but keep in journal
      setOrphanedTx(journalRead().filter(t => t.status === 'pending'))
    } finally {
      setRetryingId(null)
    }
  }

  function dismissJournaled(id: string) {
    journalUpdate(id, { status: 'dismissed' })
    setOrphanedTx(prev => prev.filter(t => t.id !== id))
  }

  useEffect(() => {
    loadProducts()
    loadRecent()
    loadPending()
    loadMiscItems()
    ;(async () => {
      try {
        const res = await fetch('/api/staff')
        if (!res.ok) {
          setStaff([])
          setCounterStaffId(null)
          return
        }
        const data: unknown = await res.json()
        const list = Array.isArray(data) ? data as StaffMember[] : []
        const active = list.filter(s => s.active)
        setStaff(active)
        const meId = parseInt(user?.id ?? '0')
        const me = active.find(s => s.id === meId)
        const anyCashier = active.find(s => s.role === 'CASHIER')
        const fallback = me ?? anyCashier ?? active[0] ?? null
        setCounterStaffId(fallback?.id ?? null)
      } catch {
        setStaff([])
        setCounterStaffId(null)
      } finally {
        setActiveClerkKey('COUNTER')
      }
    })()
  }, [loadProducts, loadRecent, loadPending, loadMiscItems, user?.id])

  useEffect(() => {
    const interval = setInterval(() => {
      void loadRecent()
    }, 15000)
    return () => clearInterval(interval)
  }, [loadRecent])

  useEffect(() => {
    const onMiscUpdated = () => {
      void loadRecent()
    }
    window.addEventListener('misc-sales:updated', onMiscUpdated)
    return () => window.removeEventListener('misc-sales:updated', onMiscUpdated)
  }, [loadRecent])

  useEffect(() => {
    scanRef.current?.focus()
  }, [])

  // ── USB Barcode Scanner ────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement

      if (e.key === 'F2') { e.preventDefault(); setShowPayment(true); setPayMode('CASH'); return }
      if (e.key === 'F3') { e.preventDefault(); setShowPayment(true); setPayMode('UPI'); return }
      if (e.key === 'F4') { e.preventDefault(); setShowPayment(true); setPayMode('CARD'); return }
      if (e.key === 'F6') { e.preventDefault(); setShowPayment(true); setPayMode('SPLIT'); return }
      if (e.key === 'F8') { e.preventDefault(); toggleVoidMode(); return }

      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') {
        if (e.key === 'Enter') {
          if (showPayment) { completeSale(); return }
        }
        return
      }

      if (e.key === 'Backspace' && cart.length > 0) {
        e.preventDefault(); setCart(prev => prev.slice(0, -1)); return
      }

      if (e.key === 'Enter') {
        if (showPayment) { completeSale(); return }
        else if (cart.length > 0) { setShowPayment(true); setPayMode('CASH'); return }
        const code = barcodeBuffer.current.trim()
        if (code.length >= 4) handleScan(code)
        barcodeBuffer.current = ''
        if (barcodeTimer.current) clearTimeout(barcodeTimer.current)
        return
      }

      if (e.key.length === 1) {
        barcodeBuffer.current += e.key
        if (barcodeTimer.current) clearTimeout(barcodeTimer.current)
        barcodeTimer.current = setTimeout(() => { barcodeBuffer.current = '' }, 120)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scan Handler ───────────────────────────────────────────────────────────
  function handleScan(code: string) {
    const found = products.find(p => p.barcode === code || p.product.itemCode === code)
    if (!found) { flash(`No product found: ${code}`, 'err'); return }
    playBeep()
    if (voidMode) { addToVoid(found); flash(`Return queued: ${found.product.name} ${found.sizeMl}${found.product.category === 'MISCELLANEOUS' ? 'pcs' : 'ml'}`, 'ok'); return }
    if (found.currentStock <= 0) { flash(`${found.product.name} — OUT OF STOCK`, 'err'); return }
    addToCart(found)
    flash(`${found.product.name} ${found.sizeMl}${found.product.category === 'MISCELLANEOUS' ? 'pcs' : 'ml'} added`, 'ok')
  }

  // ── Cart ────────────────────────────────────────────────────────────────────
  function addToCart(ps: ProductSize) {
    if (ps.currentStock <= 0) { flash('Out of stock', 'err'); return }
    setShowPayment(true)
    setCart(prev => {
      const ex = prev.find(c => c.productSizeId === ps.id)
      if (ex) {
        if (ex.qty >= ps.currentStock) { flash(`Only ${ps.currentStock} left`, 'err'); return prev }
        return prev.map(c => c.productSizeId === ps.id ? { ...c, qty: c.qty + 1 } : c)
      }
      return [...prev, {
        productSizeId: ps.id, name: ps.product.name, sizeMl: ps.sizeMl,
        sellingPrice: Number(ps.sellingPrice), qty: 1, stock: ps.currentStock,
      }]
    })
  }

  function addToVoid(ps: ProductSize) {
    setVoidItems(prev => {
      const ex = prev.find(v => v.productSizeId === ps.id)
      if (ex) return prev.map(v => v.productSizeId === ps.id ? { ...v, qty: v.qty + 1 } : v)
      return [...prev, { productSizeId: ps.id, name: ps.product.name, sizeMl: ps.sizeMl, qty: 1 }]
    })
  }

  function addToMiscCart(item: MiscItem) {
    setMiscCart(prev => {
      const ex = prev.find(c => c.itemId === item.id)
      if (ex) return prev.map(c => c.itemId === item.id ? { ...c, qty: c.qty + 1 } : c)
      return [...prev, { itemId: item.id, name: item.name, category: item.category, unit: item.unit, price: item.price, qty: 1 }]
    })
    setShowPayment(true)
    flash(`${item.name} added`, 'ok')
  }

  function setMiscQty(id: number, d: number) {
    setMiscCart(prev => prev.flatMap(c => {
      if (c.itemId !== id) return [c]
      const nq = c.qty + d
      if (nq <= 0) return []
      return [{ ...c, qty: nq }]
    }))
  }

  function setQty(id: number, d: number) {
    setCart(prev => prev.flatMap(c => {
      if (c.productSizeId !== id) return [c]
      const nq = c.qty + d
      if (nq <= 0) return []
      if (nq > c.stock) { flash(`Only ${c.stock} available`, 'err'); return [c] }
      return [{ ...c, qty: nq }]
    }))
  }

  function setVoidQty(id: number, d: number) {
    setVoidItems(prev => prev.flatMap(v => {
      if (v.productSizeId !== id) return [v]
      const nq = v.qty + d
      if (nq <= 0) return []
      return [{ ...v, qty: nq }]
    }))
  }

  const cartTotal = cart.reduce((s, c) => s + c.sellingPrice * c.qty, 0)
  const cartItems = cart.reduce((s, c) => s + c.qty, 0)
  const miscCartTotal = miscCart.reduce((s, c) => s + c.price * c.qty, 0)
  const miscCartItems = miscCart.reduce((s, c) => s + c.qty, 0)
  const billTotal = cartTotal + miscCartTotal  // combined — what the customer pays
  const splitCashNum = parseFloat(splitCash) || 0
  const splitRemainder = Math.max(0, billTotal - splitCashNum)
  const tenderedNum = parseFloat(tendered) || 0
  // For CASH: if tendered is empty, treat as exact (= billTotal). Change only shows when tendered > total.
  const effectiveTendered = payMode === 'CASH' && tendered === '' ? billTotal : tenderedNum
  const change = payMode === 'CASH' && effectiveTendered > billTotal ? effectiveTendered - billTotal : 0

  useEffect(() => {
    setBrowserOnline(typeof navigator === 'undefined' ? true : navigator.onLine)

    const onOnline = () => setBrowserOnline(true)
    const onOffline = () => setBrowserOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    let active = true

    const ping = async () => {
      setLastHeartbeatAttemptAt(Date.now())
      const ctrl = new AbortController()
      const timeout = setTimeout(() => ctrl.abort(), 5000)

      try {
        const res = await fetch('/api/pos/heartbeat', {
          cache: 'no-store',
          signal: ctrl.signal,
        })

        if (!active) return
        if (res.ok) {
          const now = Date.now()
          setHeartbeatOkAt(now)
          setHeartbeatFails(0)
          setHeartbeatConsecutiveOk(prev => prev + 1)
          return
        }
      } catch {
        // Heartbeat failures are represented via retry counters.
      } finally {
        clearTimeout(timeout)
      }

      if (!active) return
      setHeartbeatFails(prev => prev + 1)
      setHeartbeatConsecutiveOk(0)
    }

    void ping()
    const id = setInterval(() => { void ping() }, 8000)

    return () => {
      active = false
      clearInterval(id)
    }
  }, [])

  const networkState = useMemo<PosNetworkState>(() => {
    if (!browserOnline) return 'OFFLINE'
    if (!lastHeartbeatAttemptAt) return 'CHECKING'
    if (!heartbeatOkAt) return heartbeatFails > 0 ? 'RECONNECTING' : 'CHECKING'

    const now = Date.now()
    const staleHeartbeat = now - heartbeatOkAt > 20000
    if (staleHeartbeat || heartbeatFails >= 2) return 'RECONNECTING'

    const recentTxWindowMs = 5 * 60 * 1000
    const hasRecentTx = lastTxSuccessAt != null && now - lastTxSuccessAt <= recentTxWindowMs
    if (hasRecentTx && heartbeatConsecutiveOk >= 2) return 'LIVE'
    return 'CONNECTED'
  }, [
    browserOnline,
    heartbeatFails,
    heartbeatConsecutiveOk,
    heartbeatOkAt,
    lastHeartbeatAttemptAt,
    lastTxSuccessAt,
  ])

  const networkTone = networkState === 'LIVE'
    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
    : networkState === 'CONNECTED'
      ? 'bg-blue-50 border-blue-200 text-blue-700'
      : networkState === 'OFFLINE'
        ? 'bg-red-50 border-red-200 text-red-700'
        : 'bg-amber-50 border-amber-200 text-amber-700'

  const networkLabel = networkState === 'LIVE'
    ? 'LIVE'
    : networkState === 'CONNECTED'
      ? 'CONNECTED'
      : networkState === 'OFFLINE'
        ? 'OFFLINE'
        : networkState === 'CHECKING'
          ? 'CHECKING'
          : 'RECONNECTING'

  const networkHint = networkState === 'LIVE'
    ? 'Server reachable and transactions are posting'
    : networkState === 'CONNECTED'
      ? 'Server reachable; waiting for a recent successful transaction'
      : networkState === 'OFFLINE'
        ? 'Network disconnected. Switch to alternate network.'
        : networkState === 'CHECKING'
          ? 'Checking server connectivity...'
          : 'Connection unstable. Switch network if this persists.'

  const hasRecentTxError = lastTxErrorAt != null && Date.now() - lastTxErrorAt <= 3 * 60 * 1000
  const showNetworkAdvice = networkState === 'OFFLINE' || networkState === 'RECONNECTING' || (networkState !== 'LIVE' && hasRecentTxError)
  const adviceTone = networkState === 'OFFLINE'
    ? 'bg-red-50 border-red-200 text-red-800'
    : 'bg-amber-50 border-amber-200 text-amber-800'
  const adviceTitle = networkState === 'OFFLINE'
    ? 'Network offline'
    : 'Network unstable'
  const adviceText = networkState === 'OFFLINE'
    ? 'POS is not connected. Move to alternate Wi-Fi or mobile hotspot immediately.'
    : networkState === 'RECONNECTING'
      ? `Heartbeat failed ${heartbeatFails} time(s). Keep billing paused and switch network if this continues for 30 seconds.`
      : 'Recent transaction posting issue detected. Confirm signal quality or switch to alternate network before taking large bills.'

  // ── Checkout ───────────────────────────────────────────────────────────────
  async function completeSale() {
    if ((!cart.length && !miscCart.length) || !activeClerk) return

    // PENDING: tabs can only hold liquor items
    if (payMode === 'PENDING') {
      if (miscCart.length > 0) {
        flash('Misc items cannot go on a tab — charge them now', 'err'); return
      }
      await completePendingSale()
      return
    }

    // CASH: empty tendered = exact payment (fine), only block if explicitly less than total
    if (payMode === 'CASH' && tendered !== '' && tenderedNum < billTotal) {
      flash('Amount received is less than total', 'err'); return
    }
    if (payMode === 'SPLIT' && splitCashNum <= 0) { flash('Enter cash amount', 'err'); return }
    if (payMode === 'SPLIT' && splitCashNum >= billTotal) { flash('Split cash must be less than total', 'err'); return }

    setProcessing(true)

    const savedCart = [...cart]
    const savedMiscCart = [...miscCart]
    const savedClerkKey = activeClerkKey
    const savedPayMode = payMode
    const savedSplitCash = splitCash
    const savedCustomerName = customerName
    const total = billTotal  // what the customer pays (liquor + misc)
    const splitCashSaved = parseFloat(savedSplitCash) || 0
    const splitRemainderSaved = Math.max(0, total - splitCashSaved)

    // ── Write to crash-recovery journal BEFORE touching anything ──────────────
    const txId = makeId()
    const journalEntry: TxJournal = {
      id: txId,
      at: new Date().toISOString(),
      staffId: activeClerk.staffId,
      clerkLabel: activeClerk.label,
      payMode: savedPayMode,
      customerName: savedCustomerName || null,
      total,
      items: savedCart.map(item => ({
        productSizeId: item.productSizeId,
        name: item.name,
        sizeMl: item.sizeMl,
        qty: item.qty,
        sellingPrice: item.sellingPrice,
      })),
      splitCash: splitCashSaved > 0 ? splitCashSaved : undefined,
      splitMethod: savedPayMode === 'SPLIT' ? splitMethod : undefined,
      retries: 0,
      status: 'pending',
    }
    journalWrite(journalEntry)

    // Optimistic reset — cart clears immediately so cashier can start next bill
    resetSale()
    flash(`Bill complete — ${fmt(total)}`, 'ok')

    try {
      const billTimeIso = journalEntry.at  // use journal timestamp for consistency

      const needsTerminal = savedPayMode === 'CARD' || savedPayMode === 'UPI' || (savedPayMode === 'SPLIT' && (splitMethod === 'CARD' || splitMethod === 'UPI'))
      if (needsTerminal) {
        const terminalAmt = savedPayMode === 'SPLIT' ? splitRemainderSaved : total
        const tr = await fetch('/api/card-terminal/push', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: terminalAmt, type: savedPayMode === 'SPLIT' ? splitMethod : savedPayMode })
        })
        if (!tr.ok) {
          // Restore cart — terminal was rejected, nothing was posted yet
          journalClear(txId)
          setCart(savedCart); setActiveClerkKey(savedClerkKey); setPayMode(savedPayMode as PayMode)
          setSplitCash(savedSplitCash); setCustomerName(savedCustomerName); setShowPayment(true)
          flash('EDC Terminal transaction failed or rejected. Please manually retry.', 'err')
          setProcessing(false)
          return
        }
      }

      const results: unknown[] = []
      for (const item of savedCart) {
        const prop = item.sellingPrice * item.qty / total
        const body: Record<string, unknown> = {
          productSizeId: item.productSizeId, quantityBottles: item.qty,
          paymentMode: savedPayMode, scanMethod: 'MANUAL', staffId: activeClerk.staffId,
          customerName: savedCustomerName || null,
          saleTime: billTimeIso,
        }
        if (savedPayMode === 'SPLIT') {
          body.cashAmount = +(splitCashSaved * prop).toFixed(2)
          body[splitMethod === 'UPI' ? 'upiAmount' : 'cardAmount'] = +(splitRemainderSaved * prop).toFixed(2)
        }
        const res = await fetch('/api/sales', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Sale failed') }
        results.push(await res.json())
      }

      if (results.some((r: unknown) => r && typeof r === 'object' && 'error' in r)) throw new Error('One or more items failed')

      // ── Post misc items (cashier revenue, tallied under same payment mode) ──
      if (savedMiscCart.length > 0) {
        const d = new Date()
        const saleDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const miscRes = await fetch('/api/misc-sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            saleDate: saleDateStr,
            staffId: activeClerk.staffId,
            paymentMode: savedPayMode,  // same mode as the bill — owner sees full tally
            items: savedMiscCart.map(c => ({ itemId: c.itemId, quantity: c.qty })),
          }),
        })
        if (!miscRes.ok) { const e = await miscRes.json(); throw new Error(e.error || 'Misc sale failed') }
      }

      // ── All good — clear from journal ─────────────────────────────────────
      journalClear(txId)
      setLastTxSuccessAt(Date.now())
      setLastTxErrorAt(null)

      // Background refresh (non-blocking)
      loadProducts()
      loadRecent()
    } catch (e: unknown) {
      // API failed after optimistic reset. Journal entry stays — show recovery UI.
      const msg = e instanceof Error ? e.message : 'Sale failed'
      flash(`${msg} — saved for recovery`, 'err')
      setLastTxErrorAt(Date.now())
      // Surface in the orphan list immediately so cashier sees it
      setOrphanedTx(prev => [...prev.filter(t => t.id !== txId), { ...journalEntry, retries: 1 }])
    } finally {
      setProcessing(false)
      scanRef.current?.focus()
    }
  }

  async function completePendingSale() {
    if (!activeClerk) return

    const isAppend = typeof selectedTabId === 'number'
    const tabName = newTabName.trim()

    // Validation
    if (!isAppend && !tabName) {
      flash('Enter a tab name or select an existing tab', 'err'); return
    }

    setProcessing(true)
    const savedCart = [...cart]
    const savedClerkKey = activeClerkKey
    const total = cartTotal
    resetSale()
    flash(isAppend ? `Added to tab — ${fmt(total)}` : `Tab opened — ${fmt(total)}`, 'ok')

    try {
      const itemPayload = savedCart.map(item => ({
        productSizeId: item.productSizeId,
        quantityBottles: item.qty,
        sellingPrice: item.sellingPrice,
      }))

      let res: Response
      if (isAppend) {
        res = await fetch('/api/pending-bills', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedTabId, items: itemPayload }),
        })
      } else {
        res = await fetch('/api/pending-bills', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ staffId: activeClerk.staffId, customerName: tabName, items: itemPayload }),
        })
      }

      if (!res.ok) {
        const e = await res.json()
        setCart(savedCart); setActiveClerkKey(savedClerkKey)
        setPayMode('PENDING'); setShowPayment(true)
        flash(e.error || 'Failed to save tab', 'err')
        setLastTxErrorAt(Date.now())
        return
      }
      setLastTxSuccessAt(Date.now())
      setLastTxErrorAt(null)
      setSelectedTabId(null)
      setNewTabName('')
      loadPending()
    } catch (e: unknown) {
      setCart(savedCart); setActiveClerkKey(savedClerkKey)
      setPayMode('PENDING'); setShowPayment(true)
      flash(e instanceof Error ? e.message : 'Failed', 'err')
      setLastTxErrorAt(Date.now())
    } finally {
      setProcessing(false)
      scanRef.current?.focus()
    }
  }

  async function settlePendingBill(mode: 'CASH' | 'CARD' | 'UPI') {
    if (!settleTarget) return
    setSettling(true)
    try {
      const res = await fetch('/api/pending-bills', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: settleTarget.id,
          paymentMode: mode,
          settledById: activeClerk?.staffId ?? parseInt(user?.id ?? '0'),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Settlement failed')
      flash(`${settleTarget.billRef} settled — ${fmt(Number(settleTarget.totalAmount))}`, 'ok')
      setSettleTarget(null)
      loadPending()
      loadRecent()
      loadProducts()
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'Settlement failed', 'err')
    } finally {
      setSettling(false)
    }
  }

  async function voidPendingItems() {
    if (!settleTarget || pendingVoidItems.size === 0) return
    setSettling(true)
    try {
      const res = await fetch('/api/pending-bills', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: settleTarget.id,
          voidItemIds: Array.from(pendingVoidItems),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Void failed')
      if (data.deleted) {
        flash(`${settleTarget.billRef} deleted (no items left)`, 'ok')
        setSettleTarget(null)
      } else {
        flash(`Voided ${pendingVoidItems.size} item(s) from ${settleTarget.billRef}`, 'ok')
        setSettleTarget(data)
      }
      setPendingVoidMode(false)
      setPendingVoidItems(new Set())
      loadPending()
      loadProducts()
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'Void failed', 'err')
    } finally {
      setSettling(false)
    }
  }

  function resetSale() {
    setCart([]); setMiscCart([]); setPayMode('CASH'); setTendered(''); setSplitCash('')
    setCustomerName(''); setShowPayment(false); setActiveClerkKey('COUNTER')
    setSelectedTabId(null); setNewTabName('')
  }

  function flash(msg: string, type: 'ok' | 'err') {
    setToast({ msg, type }); setTimeout(() => setToast(null), 2500)
  }

  function toggleVoidMode(force?: 'on' | 'off') {
    const next = force ? force === 'on' : !voidMode
    if (next === voidMode) return

    if (next) {
      if (cart.length > 0) {
        const ok = confirm('Return mode works on returned bottles only. Clear the current bill and continue?')
        if (!ok) return
        resetSale()
      }
      setShowPayment(false)
      setVoidMode(true)
      return
    }

    // Exit return mode immediately without modal interruption.
    // This prevents barcode scanners from getting blocked by confirm dialogs.
    setVoidItems([])
    setVoidMode(false)
  }

  async function completeVoid() {
    if (!voidItems.length) return
    if (!activeClerk?.staffId) {
      flash('Select a clerk before processing return', 'err')
      return
    }
    if (!confirm(`Process return for ${voidItems.reduce((s, i) => s + i.qty, 0)} bottle(s)? Refund and stock will be updated.`)) return
    setVoidProcessing(true)
    try {
      const res = await fetch('/api/sales/void', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffId: activeClerk.staffId,
          items: voidItems.map(v => ({ productSizeId: v.productSizeId, quantityBottles: v.qty })),
          reason: 'POS return queue',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Void failed')
      const refund = data.refund as { total?: number; cash?: number; card?: number; upi?: number } | undefined
      const cashRefund = Number(refund?.cash ?? 0)
      flash(refund?.total != null ? `Void complete — refund ${fmt(Number(refund.total))} (Cash ${fmt(cashRefund)}, Card ${fmt(Number(refund.card ?? 0))}, UPI ${fmt(Number(refund.upi ?? 0))})` : 'Void complete — stock returned', 'ok')
      setVoidItems([]); setVoidMode(false)
      loadRecent(); loadProducts(); scanRef.current?.focus()
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'Void failed', 'err')
    } finally { setVoidProcessing(false) }
  }

  // ── Derived: available sizes for current category ─────────────────────────
  const availableSizes = useMemo(() => {
    const catProducts = category === 'ALL' ? products : products.filter(p => p.product.category === category)
    const sizes = Array.from(new Set(catProducts.map(p => p.sizeMl)))
      .filter(size => size !== 1)
      .sort((a, b) => a - b)
    return sizes
  }, [products, category])

  useEffect(() => {
    if (sizeFilter !== null && !availableSizes.includes(sizeFilter)) {
      setSizeFilter(null)
    }
  }, [sizeFilter, availableSizes])

  // ── Filtered Products ──────────────────────────────────────────────────────
  const filtered = products.filter(p => {
    if (category !== 'ALL' && p.product.category !== category) return false
    if (sizeFilter !== null && p.sizeMl !== sizeFilter) return false
    if (!search) return true
    const q = search.toLowerCase()
    return p.product.name.toLowerCase().includes(q) || p.product.itemCode.toLowerCase().includes(q)
  }).sort((a, b) => {
    // In-stock items first, out-of-stock at the bottom
    const aOos = a.currentStock <= 0 ? 1 : 0
    const bOos = b.currentStock <= 0 ? 1 : 0
    if (aOos !== bOos) return aOos - bOos
    return a.product.name.localeCompare(b.product.name)
  })

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden bg-slate-50" style={{ userSelect: 'none' }}>

      {/* ── Toast ────────────────────────────── */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-lg text-sm font-semibold shadow-2xl pointer-events-none transition-all ${
          toast.type === 'ok' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
        }`}>{toast.msg}</div>
      )}

      {/* ── Crash-recovery banner ─────────────── */}
      {orphanedTx.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[520px] max-w-[95vw] space-y-2">
          {orphanedTx.map(tx => (
            <div key={tx.id} className="bg-red-900 text-white rounded-2xl shadow-2xl border border-red-700 overflow-hidden">
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="text-red-300 mt-0.5 text-lg leading-none shrink-0">⚠</div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm">Unconfirmed transaction</p>
                  <p className="text-xs text-red-300 mt-0.5">
                    {tx.clerkLabel} · {tx.payMode} · {fmt(tx.total)} · {tx.items.length} item(s)
                  </p>
                  <p className="text-xs text-red-400 mt-0.5">
                    {new Date(tx.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                    {tx.retries > 0 && ` · ${tx.retries} attempt(s)`}
                  </p>
                  <p className="text-[11px] text-red-300 mt-1 truncate">
                    {tx.items.map(i => `${i.name} ${i.sizeMl}ml ×${i.qty}`).join(', ')}
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <button
                    onClick={() => retryJournaled(tx)}
                    disabled={retryingId === tx.id}
                    className="px-3 py-1.5 bg-white text-red-800 text-xs font-bold rounded-lg hover:bg-red-100 disabled:opacity-50"
                  >
                    {retryingId === tx.id ? 'Retrying...' : 'Retry now'}
                  </button>
                  <button
                    onClick={() => dismissJournaled(tx.id)}
                    className="px-3 py-1.5 bg-red-800 text-red-200 text-xs font-semibold rounded-lg hover:bg-red-700"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Settle Pending Bill Modal ─────────── */}
      {settleTarget && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-96 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900 text-lg">
                  {settleTarget.customerName || settleTarget.billRef}
                </h3>
                <p className="text-sm text-gray-500">
                  {settleTarget.customerName && <span className="font-mono text-xs text-gray-400 mr-1">{settleTarget.billRef} ·</span>}
                  {(settleTarget.staff?.name ?? 'Unknown')} · {new Date(settleTarget.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                </p>
              </div>
              <button onClick={() => { setSettleTarget(null); setPendingVoidMode(false); setPendingVoidItems(new Set()) }} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
            </div>

            {/* Items */}
            <div className="bg-gray-50 rounded-xl p-3 space-y-1.5 max-h-40 overflow-y-auto">
              {settleTarget.items.map(item => (
                <div key={item.id} className={`flex justify-between text-sm ${pendingVoidMode ? 'cursor-pointer hover:bg-gray-100 rounded p-1 -m-1' : ''}`}
                     onClick={() => pendingVoidMode && setPendingVoidItems(prev => {
                       const next = new Set(prev)
                       if (next.has(item.id)) next.delete(item.id)
                       else next.add(item.id)
                       return next
                     })}>
                  <div className="flex items-center gap-2">
                    {pendingVoidMode && (
                      <input type="checkbox" checked={pendingVoidItems.has(item.id)} readOnly
                             className="w-4 h-4 text-red-600 bg-gray-100 border-gray-300 rounded focus:ring-red-500" />
                    )}
                    <span className="text-gray-700">{item.productSize?.product?.name ?? 'Item'} {item.productSize?.sizeMl ?? 0}ml ×{item.quantityBottles}</span>
                  </div>
                  <span className="font-semibold text-gray-900">{fmt(Number(item.totalAmount))}</span>
                </div>
              ))}
            </div>

            <div className="flex justify-between items-center px-1">
              <span className="text-sm text-gray-500">Total due</span>
              <span className="text-2xl font-black text-gray-900">{fmt(Number(settleTarget.totalAmount))}</span>
            </div>

            {pendingVoidMode ? (
              <div className="space-y-3">
                <p className="text-xs font-bold text-red-600 uppercase tracking-widest">Void selected items</p>
                <p className="text-sm text-gray-600">Selected {pendingVoidItems.size} item{pendingVoidItems.size !== 1 ? 's' : ''} to void</p>
              </div>
            ) : (
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Payment method</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['CASH', 'CARD', 'UPI'] as const).map(m => (
                    <button key={m} onClick={() => setSettleMode(m)} className={`py-2.5 rounded-xl font-bold text-sm transition-all ${
                      settleMode === m ? 'bg-blue-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}>{m}</button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => { setSettleTarget(null); setPendingVoidMode(false); setPendingVoidItems(new Set()) }} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-gray-600 font-medium hover:bg-gray-50">Cancel</button>
              {pendingVoidMode ? (
                <>
                  <button onClick={() => { setPendingVoidMode(false); setPendingVoidItems(new Set()) }} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-gray-600 font-medium hover:bg-gray-50">Back</button>
                  <button onClick={() => voidPendingItems()} disabled={pendingVoidItems.size === 0}
                    className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 disabled:opacity-50">
                    Void Items
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setPendingVoidMode(true)} className="flex-1 py-2.5 border border-red-200 rounded-xl text-red-600 font-medium hover:bg-red-50">Void Items</button>
                  <button onClick={() => settlePendingBill(settleMode)} disabled={settling}
                    className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-50">
                    {settling ? 'Settling...' : 'Confirm Payment'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          LEFT PANEL — Products
         ═══════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* ── Top Bar ──────────────────────── */}
        <div className="h-14 bg-gradient-to-r from-white to-slate-50 border-b border-slate-200/60 flex items-center px-5 gap-4 flex-shrink-0 shadow-sm">
          <div className="text-slate-900 font-black text-base tracking-tight">MV <span className="text-blue-600">POS</span></div>

          {/* Barcode scan input */}
          <div className="flex-1 max-w-lg relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input ref={scanRef} value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && search.trim()) {
                  const code = search.trim()
                  const found = products.find(p => p.barcode === code || p.product.itemCode === code)
                  if (found) {
                    if (voidMode) { addToVoid(found); flash(`Return queued: ${found.product.name}`, 'ok') }
                    else { addToCart(found); flash(`${found.product.name} added`, 'ok') }
                    setSearch('')
                  } else if (filtered.length === 1) {
                    if (voidMode) addToVoid(filtered[0]); else addToCart(filtered[0])
                    setSearch('')
                  }
                }
              }}
              placeholder="Search all products..."
              className="w-full pl-10 pr-4 py-2 bg-slate-50 text-slate-800 placeholder-slate-300 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/30 border border-slate-200 focus:border-blue-400 transition-all" />
          </div>

          <div className="text-slate-400 text-xs hidden lg:block font-medium">
            {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${networkTone}`} title={networkHint}>
              <span className={`w-2 h-2 rounded-full ${networkState === 'LIVE' ? 'bg-emerald-500 animate-pulse' : networkState === 'CONNECTED' ? 'bg-blue-500' : networkState === 'OFFLINE' ? 'bg-red-500' : 'bg-amber-500 animate-pulse'}`} />
              <span className="text-xs font-bold">{networkLabel}</span>
            </div>
            {/* Pending bills badge */}
            {pendingCount > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-xs font-bold text-amber-700">{pendingCount} open {pendingCount === 1 ? 'tab' : 'tabs'}</span>
              </div>
            )}
            <button
              onClick={() => toggleVoidMode()}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-colors ${
                voidMode
                  ? 'bg-red-100 text-red-700 border-red-200 hover:bg-red-200'
                  : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
              }`}
              title="F8"
            >
              {voidMode ? `Return Mode (${voidItems.reduce((s, i) => s + i.qty, 0)})` : 'Return Mode'}
            </button>
          </div>
        </div>

        {showNetworkAdvice && (
          <div className={`mx-4 mt-2 rounded-xl border px-3 py-2.5 ${adviceTone}`}>
            <p className="text-xs font-bold uppercase tracking-wide">{adviceTitle}</p>
            <p className="text-xs mt-1">{adviceText}</p>
          </div>
        )}

        {/* ── Category Pills ───────────────── */}
        <div className="bg-white/80 backdrop-blur-sm border-b border-slate-100 flex overflow-x-auto px-4 py-2.5 gap-1.5 flex-shrink-0" style={{ scrollbarWidth: 'none' }}>
          {CATS.map(cat => {
            const colors = CAT_COLORS[cat] ?? CAT_COLORS.ALL
            const label = cat === '__MISC__' ? 'Misc Items' : cat
            return (
              <button key={cat} onClick={() => { setCategory(cat); setSizeFilter(null) }}
                className={`px-3.5 py-1.5 text-[11px] font-bold whitespace-nowrap rounded-full transition-all ${
                  category === cat ? colors.active : colors.inactive
                }`}>{label}</button>
            )
          })}
        </div>

        {/* ── Size Filter Pills ───────────────── */}
        {category !== '__MISC__' && availableSizes.length > 1 && (
          <div className="bg-white border-b border-slate-100 flex overflow-x-auto px-4 py-2 gap-1.5 flex-shrink-0" style={{ scrollbarWidth: 'none' }}>
            <button onClick={() => setSizeFilter(null)}
              className={`px-3 py-1 text-[10px] font-bold whitespace-nowrap rounded-full transition-all ${
                sizeFilter === null
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600 border border-slate-200'
              }`}>All Sizes</button>
            {availableSizes.map(size => {
              const colors = SIZE_COLORS[size] ?? DEFAULT_SIZE_COLOR
              return (
                <button key={size} onClick={() => setSizeFilter(sizeFilter === size ? null : size)}
                  className={`px-3 py-1 text-[10px] font-bold whitespace-nowrap rounded-full transition-all ${
                    sizeFilter === size ? colors.active : colors.inactive
                  }`}>{size}ml</button>
              )
            })}
          </div>
        )}

        {/* ── Product Grid ─────────────────── */}
        <div className="flex-1 overflow-y-auto p-4" style={{ scrollbarWidth: 'none' }}>
          {category === '__MISC__' ? (
            /* ── Misc Items Grid ── */
            <div>
              {/* Sub-category filter */}
              <div className="flex gap-1.5 mb-4 flex-wrap">
                {['ALL', 'CIGARETTES', 'SNACKS', 'CUPS'].map(fc => (
                  <button key={fc} onClick={() => setMiscCatFilter(fc)}
                    className={`px-3 py-1 text-[10px] font-bold rounded-full transition-all ${
                      miscCatFilter === fc ? 'bg-cyan-600 text-white shadow-sm' : 'bg-cyan-50 text-cyan-700 hover:bg-cyan-100 border border-cyan-200'
                    }`}>{fc === 'ALL' ? 'All' : fc.charAt(0) + fc.slice(1).toLowerCase()}</button>
                ))}
              </div>
              {(() => {
                const filtered2 = miscItems.filter(item => miscCatFilter === 'ALL' || item.category === miscCatFilter)
                if (filtered2.length === 0) return <div className="text-center py-16 text-gray-500 text-sm">No misc items — add them via the Misc Sales page</div>
                return (
                  <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5">
                    {filtered2.map(item => {
                      const inCart = miscCart.find(c => c.itemId === item.id)
                      return (
                        <button key={item.id} onClick={() => addToMiscCart(item)}
                          className={`relative text-left rounded-xl overflow-hidden transition-all duration-200 flex flex-col ${
                            inCart ? 'bg-white ring-2 ring-cyan-500 shadow-lg shadow-cyan-200/50 scale-[1.02]'
                            : 'bg-white hover:shadow-md hover:shadow-slate-200/60 hover:-translate-y-0.5 active:scale-[0.97] cursor-pointer border border-slate-200/60'
                          }`}>
                          <div className="h-1.5 w-full bg-cyan-400 flex-shrink-0" />
                          <div className="p-3.5 flex flex-col flex-1">
                            {inCart && (
                              <span className="absolute top-2 right-2 min-w-[20px] h-5 bg-cyan-500 text-white rounded-full text-[10px] flex items-center justify-center font-bold px-1 shadow">
                                {inCart.qty}
                              </span>
                            )}
                            <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">{item.category}</span>
                            <div className="text-[12px] font-bold text-slate-800 leading-snug line-clamp-2 flex-1 mb-2">{item.name}</div>
                            <div className="mb-2">
                              <span className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-200">per {item.unit}</span>
                            </div>
                            <div className="mt-auto">
                              <span className="text-sm font-black text-slate-900">{fmt(item.price)}</span>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-600 text-sm">
              {products.length === 0 ? 'No products loaded' : 'No matches found'}
            </div>
          ) : (
            <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5">
              {filtered.map(ps => {
                const inCart = cart.find(c => c.productSizeId === ps.id)
                const oos = ps.currentStock === 0
                const disabled = !voidMode && oos
                const catColor =
                  ps.product.category === 'BRANDY' ? 'bg-amber-400' :
                  ps.product.category === 'WHISKY' ? 'bg-yellow-400' :
                  ps.product.category === 'RUM' ? 'bg-orange-400' :
                  ps.product.category === 'VODKA' ? 'bg-sky-400' :
                  ps.product.category === 'BEER' ? 'bg-yellow-300' :
                  ps.product.category === 'WINE' ? 'bg-rose-400' : 'bg-slate-300'
                return (
                  <button key={ps.id} onClick={() => (voidMode ? addToVoid(ps) : addToCart(ps))} disabled={disabled}
                    className={`relative text-left rounded-xl overflow-hidden transition-all duration-200 flex flex-col ${
                      disabled ? 'bg-slate-50 opacity-35 cursor-not-allowed border border-slate-100 grayscale'
                        : inCart ? 'bg-white ring-2 ring-blue-500 shadow-lg shadow-blue-200/50 scale-[1.02]'
                        : voidMode ? 'bg-white border border-red-200 hover:shadow-lg hover:border-red-400 cursor-pointer'
                        : 'bg-white hover:shadow-md hover:shadow-slate-200/60 hover:-translate-y-0.5 active:scale-[0.97] cursor-pointer border border-slate-200/60'
                    }`}>
                    <div className={`h-1.5 w-full ${catColor} flex-shrink-0`} />
                    <div className="p-3.5 flex flex-col flex-1">
                      {inCart && (
                        <span className="absolute top-2 right-2 min-w-[20px] h-5 bg-blue-500 text-white rounded-full text-[10px] flex items-center justify-center font-bold px-1 shadow">
                          {inCart.qty}
                        </span>
                      )}
                      <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">{ps.product.category}</span>
                      <div className="text-[12px] font-bold text-slate-800 leading-snug line-clamp-2 flex-1 mb-2">{ps.product.name}</div>
                      <div className="mb-2">
                        {(() => {
                          const sc = SIZE_COLORS[ps.sizeMl] ?? DEFAULT_SIZE_COLOR
                          return <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${sc.inactive}`}>{ps.sizeMl}{ps.product.category === 'MISCELLANEOUS' ? 'pcs' : 'ml'}</span>
                        })()}
                      </div>
                      <div className="flex items-center justify-between mt-auto">
                        <span className="text-sm font-black text-slate-900">{fmt(Number(ps.sellingPrice))}</span>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${oos ? 'bg-red-50 text-red-500' : ps.currentStock <= 6 ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
                          {oos ? 'NIL' : `${ps.currentStock}`}
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════
          RIGHT PANEL — Bill
         ═══════════════════════════════════════════════════ */}
      <div className="w-[380px] bg-white border-l border-slate-200 flex flex-col flex-shrink-0 shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.05)]">

        {/* Bill Header */}
        <div className="h-16 border-b border-slate-100 flex items-center justify-between px-6 flex-shrink-0">
          <div>
            <p className="text-slate-900 font-black text-base tracking-tight leading-none">Current Bill</p>
            <p className="text-[11px] text-slate-400 font-medium mt-0.5">{activeClerk?.label ?? 'No clerk'}</p>
          </div>
          {(cart.length > 0 || miscCart.length > 0) && (
            <button onClick={() => { setCart([]); setMiscCart([]); setShowPayment(false) }}
              className="text-[10px] text-red-400 hover:text-red-600 font-bold uppercase tracking-widest px-2.5 py-1 bg-red-50 hover:bg-red-100 rounded-lg transition-colors border border-red-100">
              Clear
            </button>
          )}
        </div>

        {/* Supplier selector */}
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 space-y-2">
          <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-400">Bill To</div>
          <div className="grid grid-cols-5 gap-1.5">
            {topClerkOptions.map(c => (
              <button key={c.key} onClick={() => setActiveClerkKey(c.key)}
                className={`h-14 rounded-xl border px-1 text-center text-[11px] font-bold transition-all flex items-center justify-center leading-tight ${
                  activeClerk?.key === c.key ? 'bg-blue-600 text-white border-blue-500 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
                }`}>
                <span className="line-clamp-2">{c.label}</span>
              </button>
            ))}
            {topClerkOptions.length === 0 && (
              <div className="col-span-5 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-center text-xs font-semibold text-slate-400">No active suppliers</div>
            )}
          </div>
        </div>

        {/* ── Open Tabs (always visible, collapsible) ── */}
        {pendingBills.length > 0 && (
          <div className="border-b border-amber-100 flex-shrink-0">
            <button
              onClick={() => setTabsCollapsed(v => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-amber-50/60 hover:bg-amber-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-amber-700 uppercase tracking-[0.15em]">Open Tabs</span>
                <span className="px-1.5 py-0.5 bg-amber-200 text-amber-800 text-[9px] font-black rounded-full">{pendingBills.length}</span>
              </div>
              <svg className={`w-3.5 h-3.5 text-amber-500 transition-transform duration-200 ${tabsCollapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {!tabsCollapsed && (
              <div className="px-3 pb-3 space-y-1.5 max-h-56 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                {pendingBills.map(pb => (
                  <button key={pb.id} onClick={() => { syncClerkFromTab(pb); setSettleTarget(pb); setSettleMode('CASH') }}
                    className="w-full text-left bg-white border border-amber-200 rounded-xl px-3 py-2.5 hover:border-amber-400 hover:bg-amber-50/60 transition-all active:scale-[0.98]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-800 leading-none truncate">
                          {pb.customerName || pb.billRef}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-1">
                          {pb.billRef} · {(pb.staff?.name ?? 'Unknown')} · {pb.items.length} item(s)
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {new Date(pb.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                        </p>
                      </div>
                      <span className="text-sm font-black text-slate-900 shrink-0">{fmt(Number(pb.totalAmount))}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Bill Items */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          {voidMode && (
            <div className="px-4 py-3 border-b border-red-100 bg-red-50/60">
              <p className="text-[11px] font-bold text-red-700 uppercase tracking-wider">Return Queue</p>
              {voidItems.length === 0 ? (
                <p className="text-xs text-red-500 mt-1">Scan returned bottles to queue them, then press Process Return.</p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {voidItems.map(item => (
                    <div key={item.productSizeId} className="flex items-center justify-between bg-white border border-red-100 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800 truncate">{item.name}</p>
                        <p className="text-[10px] text-slate-400">{item.sizeMl}ml</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setVoidQty(item.productSizeId, -1)} className="w-6 h-6 rounded bg-red-50 text-red-700 font-black text-sm">−</button>
                        <span className="w-7 text-center text-xs font-black text-red-700">{item.qty}</span>
                        <button onClick={() => setVoidQty(item.productSizeId, +1)} className="w-6 h-6 rounded bg-red-50 text-red-700 font-black text-sm">+</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={completeVoid}
                  disabled={voidProcessing || voidItems.length === 0 || processing}
                  className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-colors"
                >
                  {voidProcessing ? 'Processing...' : 'Process Return'}
                </button>
                <button
                  onClick={() => toggleVoidMode('off')}
                  disabled={voidProcessing || processing}
                  className="px-3 py-2 border border-red-200 text-red-700 bg-white hover:bg-red-50 rounded-lg text-xs font-semibold disabled:opacity-50"
                >
                  Exit
                </button>
              </div>
            </div>
          )}

          {cart.length === 0 && miscCart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-300 gap-3 px-8">
              <svg className="w-12 h-12 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
              <p className="text-sm font-semibold text-slate-300">Add items to start a bill</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {/* ── Liquor items ── */}
              {cart.map((item, idx) => (
                <div key={item.productSizeId} className="px-5 py-3.5 hover:bg-slate-50/60 transition-colors group">
                  <div className="flex items-start gap-2.5">
                    <span className="text-[10px] text-slate-300 font-bold mt-0.5 w-4 flex-shrink-0">{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 leading-snug">{item.name}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{item.sizeMl}ml · {fmt(item.sellingPrice)}</p>
                    </div>
                    <button onClick={() => setCart(prev => prev.filter(c => c.productSizeId !== item.productSizeId))}
                      className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all flex-shrink-0 text-xl leading-none mt-0.5">×</button>
                  </div>
                  <div className="flex items-center justify-between mt-3 pl-6">
                    <div className="flex items-center bg-slate-100 rounded-lg border border-slate-200 overflow-hidden">
                      <button onClick={() => setQty(item.productSizeId, -1)} className="w-7 h-7 text-slate-500 hover:text-slate-900 hover:bg-slate-200 font-bold flex items-center justify-center transition text-base">−</button>
                      <span className="w-8 text-center text-xs font-bold text-slate-800">{item.qty}</span>
                      <button onClick={() => setQty(item.productSizeId, +1)} className="w-7 h-7 text-slate-500 hover:text-slate-900 hover:bg-slate-200 font-bold flex items-center justify-center transition text-base">+</button>
                    </div>
                    <span className="text-sm font-black text-slate-900">{fmt(item.sellingPrice * item.qty)}</span>
                  </div>
                </div>
              ))}

              {/* ── Misc items divider + rows ── */}
              {miscCart.length > 0 && (
                <>
                  <div className="px-5 py-2 bg-cyan-50 flex items-center justify-between">
                    <p className="text-[9px] font-bold text-cyan-700 uppercase tracking-widest">Misc — Cashier Float</p>
                    <span className="text-[9px] text-cyan-500 font-semibold">{fmt(miscCartTotal)}</span>
                  </div>
                  {miscCart.map((item, idx) => (
                    <div key={item.itemId} className="px-5 py-3 hover:bg-cyan-50/30 transition-colors group">
                      <div className="flex items-start gap-2.5">
                        <span className="text-[10px] text-cyan-300 font-bold mt-0.5 w-4 flex-shrink-0">{cart.length + idx + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-800 leading-snug">{item.name}</p>
                          <p className="text-[11px] text-cyan-600 mt-0.5">per {item.unit} · {fmt(item.price)}</p>
                        </div>
                        <button onClick={() => setMiscCart(prev => prev.filter(c => c.itemId !== item.itemId))}
                          className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all flex-shrink-0 text-xl leading-none mt-0.5">×</button>
                      </div>
                      <div className="flex items-center justify-between mt-3 pl-6">
                        <div className="flex items-center bg-slate-100 rounded-lg border border-slate-200 overflow-hidden">
                          <button onClick={() => setMiscQty(item.itemId, -1)} className="w-7 h-7 text-slate-500 hover:text-slate-900 hover:bg-slate-200 font-bold flex items-center justify-center transition text-base">−</button>
                          <span className="w-8 text-center text-xs font-bold text-slate-800">{item.qty}</span>
                          <button onClick={() => setMiscQty(item.itemId, +1)} className="w-7 h-7 text-slate-500 hover:text-slate-900 hover:bg-slate-200 font-bold flex items-center justify-center transition text-base">+</button>
                        </div>
                        <span className="text-sm font-black text-cyan-700">{fmt(item.price * item.qty)}</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Last Sales Ticker ─────────────── */}
        {cart.length === 0 && miscCart.length === 0 && recentBills.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/50">
            {todayMiscSales.totalAmount > 0 && (
              <div className="mb-3 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-700">Today Misc Sales</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs text-cyan-700">{todayMiscSales.items} items · {todayMiscSales.entries} entries</span>
                  <span className="text-sm font-black text-cyan-900">{fmt(todayMiscSales.totalAmount)}</span>
                </div>
              </div>
            )}
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-3">Recent Bills</p>
            <div className="space-y-2 max-h-48 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              {recentBills.slice(0, 6).map(bill => (
                <div key={bill.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[12px] font-bold text-slate-800">{bill.clerkName}</p>
                      <p className="text-[10px] text-slate-400">
                        {new Date(bill.saleTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {bill.paymentMode} · {bill.lines} line(s)
                      </p>
                    </div>
                    <span className="text-slate-900 text-sm font-black whitespace-nowrap">{fmt(bill.totalAmount)}</span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-500 line-clamp-2">
                    {bill.items.map(i => `${i.productName} ${i.sizeMl}ml ×${i.quantityBottles}`).join(', ')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Payment Footer ──────────────── */}
        {(cart.length > 0 || miscCart.length > 0) && (
          <div className="border-t border-slate-100 bg-white flex-shrink-0">

            {/* Receipt-style totals */}
            <div className="px-5 pt-4 pb-3 space-y-1.5">
              {cartTotal > 0 && miscCartTotal > 0 ? (
                <>
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Liquor ({cartItems} {cartItems === 1 ? 'bottle' : 'bottles'})</span>
                    <span className="font-semibold text-slate-600">{fmt(cartTotal)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-cyan-600">
                    <span>Misc ({miscCartItems} {miscCartItems === 1 ? 'item' : 'items'}) · cashier keeps</span>
                    <span className="font-semibold">{fmt(miscCartTotal)}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Subtotal ({cartItems + miscCartItems} {(cartItems + miscCartItems) === 1 ? 'item' : 'items'})</span>
                  <span className="font-semibold text-slate-600">{fmt(billTotal)}</span>
                </div>
              )}
              <div className="border-t border-dashed border-slate-200 pt-2 flex justify-between items-center">
                <span className="text-sm font-bold text-slate-700">Total</span>
                <span className="text-2xl font-black text-slate-900 tracking-tight">{fmt(billTotal)}</span>
              </div>
            </div>

            {/* Payment mode selection */}
            {!showPayment ? (
              <div className="px-5 pb-5">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      if (voidMode) {
                        void completeVoid()
                        return
                      }
                      if (confirm('Clear current bill?')) resetSale()
                    }}
                    disabled={voidProcessing || processing || (voidMode && voidItems.length === 0)}
                    className="py-3.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-red-100">
                    {voidMode ? (voidProcessing ? 'Processing...' : 'Process Return') : 'Clear Bill'}
                  </button>
                  <button onClick={() => { setShowPayment(true); setPayMode('CASH') }}
                    className="py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl transition-all active:scale-[0.98] shadow-md shadow-blue-100 flex items-center justify-center gap-2">
                    Pay
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-5 pb-5 space-y-3">
                {/* Payment mode buttons */}
                <div className="grid grid-cols-5 gap-1.5">
                  {(['CASH', 'CARD', 'UPI', 'SPLIT', 'PENDING'] as const).map(m => {
                    const modeColor = m === 'CASH' ? 'bg-emerald-600 text-white shadow-sm'
                      : m === 'CARD' ? 'bg-blue-600 text-white shadow-sm'
                      : m === 'UPI' ? 'bg-teal-600 text-white shadow-sm'
                      : m === 'SPLIT' ? 'bg-violet-600 text-white shadow-sm'
                      : 'bg-amber-500 text-white shadow-sm'
                    return (
                      <button key={m} onClick={() => { setPayMode(m); if (m !== 'PENDING') { setSelectedTabId(null); setNewTabName('') } }}
                        className={`py-2.5 text-[10px] font-bold rounded-lg transition-all ${
                          payMode === m ? modeColor : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}>{m}</button>
                    )
                  })}
                </div>

                {/* Cash — tendered with autofill and change calc */}
                {payMode === 'CASH' && (
                  <div className="bg-slate-50 rounded-xl p-3.5 space-y-2.5 border border-slate-200">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest w-16 shrink-0">Received</span>
                      <input
                        type="number"
                        value={tendered}
                        onChange={e => setTendered(e.target.value)}
                        placeholder={billTotal.toString()}
                        autoFocus
                        className="flex-1 w-full min-w-0 text-base px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg text-right font-black outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                      />
                    </div>
                    {/* Change display */}
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                        {tendered === '' ? 'Exact amount' : change > 0 ? 'Change Due' : tenderedNum < cartTotal ? 'Short by' : 'Exact'}
                      </span>
                      <span className={`text-lg font-black ${
                        tendered === '' ? 'text-slate-400' :
                        change > 0 ? 'text-emerald-600' :
                        tenderedNum < billTotal ? 'text-red-500' :
                        'text-slate-400'
                      }`}>
                        {tendered === '' ? fmt(billTotal) : change > 0 ? fmt(change) : tenderedNum < billTotal ? fmt(billTotal - tenderedNum) : '✓ Exact'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Split */}
                {payMode === 'SPLIT' && (
                  <div className="bg-slate-50 rounded-xl p-3.5 space-y-2.5 border border-slate-200">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest w-16">Cash</span>
                      <input type="number" value={splitCash} onChange={e => setSplitCash(e.target.value)}
                        placeholder="0" autoFocus
                        className="flex-1 w-full min-w-0 text-base px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg text-right font-black outline-none focus:ring-2 focus:ring-violet-500 transition-all" />
                    </div>
                    <div className="flex items-center gap-2.5">
                      <select value={splitMethod} onChange={e => setSplitMethod(e.target.value === 'CARD' ? 'CARD' : 'UPI')}
                        className="w-20 bg-white text-violet-600 text-[11px] font-bold rounded-lg outline-none focus:ring-2 focus:ring-violet-500 border border-slate-200 py-2 px-2 cursor-pointer uppercase tracking-wide">
                        <option value="UPI">UPI</option>
                        <option value="CARD">CARD</option>
                      </select>
                      <div className="flex-1 text-base px-3 py-2 bg-violet-50 text-violet-700 rounded-lg text-right font-black border border-violet-100">
                        {fmt(splitRemainder)}
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab picker */}
                {payMode === 'PENDING' && (
                  <div className="bg-amber-50 rounded-xl border border-amber-200 overflow-hidden">
                    <div className="px-3.5 pt-3 pb-2">
                      <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-2">Add to Tab</p>

                      {/* Existing tabs */}
                      {pendingBills.length > 0 && (
                        <div className="space-y-1.5 mb-2">
                          {pendingBills.map(pb => (
                            <button
                              key={pb.id}
                              onClick={() => {
                                if (selectedTabId === pb.id) {
                                  setSelectedTabId(null)
                                  return
                                }
                                setSelectedTabId(pb.id)
                                syncClerkFromTab(pb)
                              }}
                              className={`w-full text-left rounded-lg px-3 py-2 border transition-all text-sm ${
                                selectedTabId === pb.id
                                  ? 'bg-amber-500 border-amber-500 text-white'
                                  : 'bg-white border-amber-200 text-slate-700 hover:border-amber-400'
                              }`}
                            >
                              <span className="font-bold">{pb.customerName || pb.billRef}</span>
                              <span className={`ml-2 text-xs ${selectedTabId === pb.id ? 'text-amber-100' : 'text-slate-400'}`}>
                                {fmt(Number(pb.totalAmount))} · {pb.items.length} item(s)
                              </span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* New tab row */}
                      <button
                        onClick={() => setSelectedTabId(selectedTabId === 'NEW' ? null : 'NEW')}
                        className={`w-full text-left rounded-lg px-3 py-2 border transition-all text-sm font-bold ${
                          selectedTabId === 'NEW'
                            ? 'bg-amber-500 border-amber-500 text-white'
                            : 'bg-white border-dashed border-amber-300 text-amber-600 hover:border-amber-500'
                        }`}
                      >
                        + New Tab
                      </button>

                      {selectedTabId === 'NEW' && (
                        <input
                          autoFocus
                          value={newTabName}
                          onChange={e => setNewTabName(e.target.value)}
                          placeholder="Customer name (e.g. Table 3, Ravi)"
                          className="mt-2 w-full px-3 py-2.5 bg-white border border-amber-300 rounded-lg text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-amber-400 placeholder:text-slate-300"
                        />
                      )}
                    </div>
                    {selectedTabId !== null && (
                      <div className="px-3.5 pb-2.5 text-[10px] text-amber-600">
                        {typeof selectedTabId === 'number'
                          ? `Items will be added to "${pendingBills.find(p => p.id === selectedTabId)?.customerName || 'this tab'}"`
                          : 'A new tab will be opened'}
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      if (voidMode) {
                        void completeVoid()
                        return
                      }
                      if (confirm('Clear current bill?')) resetSale()
                    }}
                    disabled={voidProcessing || processing || (voidMode && voidItems.length === 0)}
                    className="py-3.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-red-100">
                    {voidMode ? (voidProcessing ? 'Processing...' : 'Process Return') : 'Clear Bill'}
                  </button>
                  <button onClick={() => completeSale()} disabled={processing || voidProcessing}
                    className={`py-3.5 text-sm font-bold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 ${
                      payMode === 'CASH' ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200/60' :
                      payMode === 'CARD' ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200/60' :
                      payMode === 'UPI' ? 'bg-teal-600 hover:bg-teal-700 text-white shadow-teal-200/60' :
                      payMode === 'SPLIT' ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-violet-200/60' :
                      payMode === 'PENDING' ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-200/60' :
                      'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200/60'
                    }`}>
                    {processing ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-5 h-5 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                        Saving...
                      </div>
                    ) : payMode === 'PENDING'
                      ? (typeof selectedTabId === 'number' ? 'Add to Tab' : 'Open Tab')
                      : 'Complete Transaction'}
                  </button>
                </div>

                {/* Back */}
                <button onClick={() => setShowPayment(false)}
                  className="w-full py-2 text-xs text-slate-400 hover:text-slate-600 font-black transition-all uppercase tracking-[0.2em] mt-2">
                  ← Back to Bill
                </button>
              </div>
            )}
          </div>
        )}

        {/* Empty footer */}
        {cart.length === 0 && miscCart.length === 0 && recentBills.length === 0 && pendingBills.length === 0 && ( // keep for true-empty state
          <div className="border-t border-[#252836] px-4 py-3 text-center">
            <p className="text-[10px] text-gray-600">{activeClerk ? `${activeClerk.label} selected` : 'Select a supplier'}{lastTxErrorAt ? ' · recent transaction issue detected' : ''}</p>
          </div>
        )}
      </div>
    </div>
  )
}
