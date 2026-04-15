// Shared types mirroring the electron/db.ts types in the renderer context

export type Product = {
  id: number
  item_code: string
  name: string
  category: string
  size_id: number
  size_ml: number
  bottles_per_case: number
  barcode: string | null
  mrp: number
  selling_price: number
  stock: number
}

export type Staff = {
  id: number
  name: string
  role: string
  pin: string | null
  face_profile_json: string | null
  active: number
}

export type Sale = {
  local_id: string
  sale_date: string
  sale_time: string
  staff_id: number
  product_size_id: number
  product_name: string
  size_ml: number
  quantity: number
  selling_price: number
  total_amount: number
  payment_mode: string
  cash_amount: number | null
  card_amount: number | null
  upi_amount: number | null
  scan_method: string
  customer_name: string | null
  server_id: number | null
  synced: number
  sync_error: string | null
  created_at: number
}

export type AttendanceRecord = {
  local_id: string
  staff_id: number
  staff_name: string
  date: string
  check_in: string | null
  check_out: string | null
  status: string
  server_id: number | null
  synced: number
}

export type Expense = {
  local_id: string
  exp_date: string
  particulars: string
  category: string
  amount: number
  server_id: number | null
  synced: number
}

export type CashRecord = {
  local_id: string
  record_date: string
  opening_register: number
  cash_sales: number
  expenses: number
  cash_to_locker: number
  closing_register: number
  card_sales: number
  upi_sales: number
  credit_sales: number
  credit_collected: number
  notes: string | null
  server_id: number | null
  synced: number
}

export type MiscItem = {
  id: number
  name: string
  price: number
  barcode: string | null
  active: number
}

export type MiscTotals = {
  misc_revenue: number
  misc_items_sold: number
}

export type DailyTotals = {
  bill_count: number
  total_bottles: number
  gross_revenue: number
  cash_total: number
  card_total: number
  upi_total: number
}

export type SyncStatus = {
  isOnline: boolean
  isSyncing: boolean
  lastPullAt: number | null
  lastPushAt: number | null
  pendingSales: number
  pendingAttendance: number
  pendingExpenses: number
}

// Window API exposed by preload.ts
export interface PosAPI {
  getProducts: () => Promise<Product[]>
  getProductByBarcode: (barcode: string) => Promise<Product | null>
  getStaff: () => Promise<Staff[]>
  insertSale: (input: Omit<Sale, 'local_id' | 'sale_date' | 'sale_time' | 'server_id' | 'synced' | 'sync_error' | 'created_at'>) => Promise<{ ok: boolean; sale?: Sale; error?: string }>
  getTodaySales: () => Promise<Sale[]>
  getTodayTotals: () => Promise<DailyTotals>
  voidSale: (localId: string) => Promise<{ ok: boolean; error?: string }>
  checkIn: (staffId: number, staffName: string) => Promise<{ ok: boolean; record?: AttendanceRecord; error?: string }>
  checkOut: (staffId: number) => Promise<{ ok: boolean; record?: AttendanceRecord; error?: string }>
  getTodayAttendance: () => Promise<AttendanceRecord[]>
  getAttendanceForStaffToday: (staffId: number) => Promise<AttendanceRecord | null>
  insertExpense: (input: { particulars: string; category: string; amount: number }) => Promise<{ ok: boolean; expense?: Expense; error?: string }>
  getTodayExpenses: () => Promise<Expense[]>
  getTodayCashRecord: () => Promise<CashRecord | null>
  upsertCashRecord: (data: Partial<CashRecord> & { record_date: string }) => Promise<{ ok: boolean; record?: CashRecord; error?: string }>
  getSyncStatus: () => Promise<SyncStatus>
  triggerSync: () => Promise<SyncStatus>
  getSettings: () => Promise<{ cloud_url: string; sync_token: string; outlet_name: string }>
  saveSettings: (data: { cloud_url?: string; sync_token?: string; outlet_name?: string }) => Promise<{ ok: boolean }>
  getMiscItems: () => Promise<MiscItem[]>
  getMiscItemByBarcode: (barcode: string) => Promise<MiscItem | null>
  saveMiscItem: (item: { id?: number; name: string; price: number; barcode?: string | null }) => Promise<{ ok: boolean; item?: MiscItem; error?: string }>
  deleteMiscItem: (id: number) => Promise<{ ok: boolean; error?: string }>
  insertMiscSale: (input: { staff_id: number; item_name: string; quantity: number; price: number; total: number; payment_mode: string }) => Promise<{ ok: boolean; error?: string }>
  getMiscTotalsToday: () => Promise<MiscTotals>
  onSyncEvent: (callback: (event: string, data: unknown) => void) => () => void
  onUpdaterEvent: (callback: (event: 'available' | 'downloaded', info: unknown) => void) => () => void
  installUpdate: () => Promise<void>
  getVersion: () => Promise<string>
}

declare global {
  interface Window {
    posAPI: PosAPI
  }
}
