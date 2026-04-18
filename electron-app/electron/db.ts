/**
 * Local SQLite database — offline-first storage for the Windows POS app.
 *
 * Design principles:
 *  - Every write is atomic (SQLite transactions)
 *  - Every record carries a localId (nanoid UUID) so syncs are idempotent
 *  - Synced records keep their server-assigned id for deduplication
 *  - Nothing is deleted from pending tables until the server acks it
 *  - WAL mode: crash-safe, allows concurrent reads during writes
 */

import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import { nanoid } from 'nanoid'

// ── Database location ─────────────────────────────────────────────────────────
const DB_PATH = path.join(app.getPath('userData'), 'pos-local.db')

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db
  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')      // crash-safe
  _db.pragma('synchronous = NORMAL')    // safe + fast (WAL mode)
  _db.pragma('foreign_keys = ON')
  _db.pragma('busy_timeout = 5000')     // wait up to 5s on lock
  migrate(_db)
  return _db
}

// ── Schema migration ──────────────────────────────────────────────────────────
function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `)

  const versionRow = db.prepare(`SELECT value FROM schema_meta WHERE key='version'`).get() as { value: string } | undefined
  const currentVersion = versionRow ? parseInt(versionRow.value) : 0

  if (currentVersion < 1) {
    db.exec(`
      -- ── Product catalog (synced from cloud, read-only on device) ─────────────
      CREATE TABLE IF NOT EXISTS products_cache (
        id            INTEGER PRIMARY KEY,
        item_code     TEXT    NOT NULL,
        name          TEXT    NOT NULL,
        category      TEXT    NOT NULL,
        size_id       INTEGER NOT NULL UNIQUE,
        size_ml       INTEGER NOT NULL,
        bottles_per_case INTEGER NOT NULL DEFAULT 12,
        barcode       TEXT,
        mrp           REAL    NOT NULL,
        selling_price REAL    NOT NULL,
        stock         INTEGER NOT NULL DEFAULT 0,
        synced_at     INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_products_barcode ON products_cache(barcode);

      -- ── Staff cache (synced from cloud, read-only on device) ─────────────────
      CREATE TABLE IF NOT EXISTS staff_cache (
        id                   INTEGER PRIMARY KEY,
        name                 TEXT NOT NULL,
        role                 TEXT NOT NULL,
        pin                  TEXT,
        active               INTEGER NOT NULL DEFAULT 1,
        synced_at            INTEGER NOT NULL DEFAULT 0
      );

      -- ── Pending sales ─────────────────────────────────────────────────────────
      -- All bills written here first.  sync engine pushes to cloud and marks synced=1.
      CREATE TABLE IF NOT EXISTS pending_sales (
        local_id        TEXT    PRIMARY KEY,   -- nanoid
        sale_date       TEXT    NOT NULL,       -- YYYY-MM-DD
        sale_time       TEXT    NOT NULL,       -- ISO 8601
        staff_id        INTEGER NOT NULL,
        product_size_id INTEGER NOT NULL,
        product_name    TEXT    NOT NULL,       -- snapshot at time of sale
        size_ml         INTEGER NOT NULL,
        quantity        INTEGER NOT NULL,
        selling_price   REAL    NOT NULL,
        total_amount    REAL    NOT NULL,
        payment_mode    TEXT    NOT NULL,
        cash_amount     REAL,
        card_amount     REAL,
        upi_amount      REAL,
        scan_method     TEXT    NOT NULL DEFAULT 'MANUAL',
        customer_name   TEXT,
        server_id       INTEGER,               -- set after cloud ack
        synced          INTEGER NOT NULL DEFAULT 0,  -- 0=pending 1=synced 2=failed
        sync_error      TEXT,
        created_at      INTEGER NOT NULL       -- unix ms
      );
      CREATE INDEX IF NOT EXISTS idx_sales_synced ON pending_sales(synced);
      CREATE INDEX IF NOT EXISTS idx_sales_date   ON pending_sales(sale_date);

      -- ── Pending attendance ────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS pending_attendance (
        local_id    TEXT    PRIMARY KEY,
        staff_id    INTEGER NOT NULL,
        staff_name  TEXT    NOT NULL,
        date        TEXT    NOT NULL,         -- YYYY-MM-DD
        check_in    TEXT,                     -- ISO 8601 or null
        check_out   TEXT,                     -- ISO 8601 or null
        status      TEXT    NOT NULL DEFAULT 'PRESENT',
        server_id   INTEGER,
        synced      INTEGER NOT NULL DEFAULT 0,
        sync_error  TEXT,
        created_at  INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_att_staff_date ON pending_attendance(staff_id, date);
      CREATE INDEX IF NOT EXISTS idx_att_synced ON pending_attendance(synced);

      -- ── Pending expenses ──────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS pending_expenses (
        local_id    TEXT    PRIMARY KEY,
        exp_date    TEXT    NOT NULL,
        particulars TEXT    NOT NULL,
        category    TEXT    NOT NULL DEFAULT 'OTHER',
        amount      REAL    NOT NULL,
        server_id   INTEGER,
        synced      INTEGER NOT NULL DEFAULT 0,
        sync_error  TEXT,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_exp_synced ON pending_expenses(synced);

      -- ── Pending cash records ──────────────────────────────────────────────────
      -- One row per day. Updated in place as the day progresses.
      CREATE TABLE IF NOT EXISTS pending_cash_records (
        local_id          TEXT    PRIMARY KEY,
        record_date       TEXT    NOT NULL UNIQUE,   -- YYYY-MM-DD
        opening_register  REAL    NOT NULL DEFAULT 0,
        cash_sales        REAL    NOT NULL DEFAULT 0,
        expenses          REAL    NOT NULL DEFAULT 0,
        cash_to_locker    REAL    NOT NULL DEFAULT 0,
        closing_register  REAL    NOT NULL DEFAULT 0,
        card_sales        REAL    NOT NULL DEFAULT 0,
        upi_sales         REAL    NOT NULL DEFAULT 0,
        credit_sales      REAL    NOT NULL DEFAULT 0,
        credit_collected  REAL    NOT NULL DEFAULT 0,
        notes             TEXT,
        server_id         INTEGER,
        synced            INTEGER NOT NULL DEFAULT 0,
        sync_error        TEXT,
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cash_synced ON pending_cash_records(synced);

      -- ── Sync log ──────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS sync_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        operation   TEXT    NOT NULL,   -- 'push' | 'pull'
        entity      TEXT    NOT NULL,   -- 'sales' | 'attendance' | 'expenses' | 'cash' | 'catalog'
        record_count INTEGER NOT NULL DEFAULT 0,
        success     INTEGER NOT NULL DEFAULT 0,
        error       TEXT,
        created_at  INTEGER NOT NULL
      );

      -- ── App settings ──────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)

    db.prepare(`INSERT OR REPLACE INTO schema_meta VALUES ('version', '1')`).run()
  }

  if (currentVersion < 2) {
    db.exec(`
      -- ── Misc items catalog (cashier-stocked goods: cigarettes, cups, snacks) ──
      -- Admin manages this list. Cashiers pick from it or add one-off items.
      -- No inventory tracking — cashiers own the stock and keep the profit.
      CREATE TABLE IF NOT EXISTS misc_items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        price       REAL    NOT NULL,
        barcode     TEXT,
        active      INTEGER NOT NULL DEFAULT 1,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      -- ── Misc sales (local-only, used to pay out cashiers their earnings) ──────
      CREATE TABLE IF NOT EXISTS misc_sales (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_date    TEXT    NOT NULL,
        staff_id     INTEGER NOT NULL,
        item_name    TEXT    NOT NULL,
        quantity     INTEGER NOT NULL,
        price        REAL    NOT NULL,
        total        REAL    NOT NULL,
        payment_mode TEXT    NOT NULL,
        created_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_misc_sales_date    ON misc_sales(sale_date);
      CREATE INDEX IF NOT EXISTS idx_misc_sales_staff   ON misc_sales(staff_id, sale_date);
    `)
    db.prepare(`INSERT OR REPLACE INTO schema_meta VALUES ('version', '2')`).run()
  }

  if (currentVersion < 3) {
    db.exec(`
      ALTER TABLE staff_cache ADD COLUMN face_profile_json TEXT;
    `)
    db.prepare(`INSERT OR REPLACE INTO schema_meta VALUES ('version', '3')`).run()
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function newId(): string {
  return nanoid()
}

export function nowMs(): number {
  return Date.now()
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── Products ──────────────────────────────────────────────────────────────────
export type ProductRow = {
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

export function getProducts(db: Database.Database): ProductRow[] {
  return db.prepare(`SELECT * FROM products_cache ORDER BY category, name, size_ml`).all() as ProductRow[]
}

export function getProductByBarcode(db: Database.Database, barcode: string): ProductRow | null {
  return (db.prepare(`SELECT * FROM products_cache WHERE barcode = ?`).get(barcode) as ProductRow | undefined) ?? null
}

export function upsertProducts(db: Database.Database, rows: ProductRow[]): void {
  const stmt = db.prepare(`
    INSERT INTO products_cache
      (id, item_code, name, category, size_id, size_ml, bottles_per_case, barcode, mrp, selling_price, stock, synced_at)
    VALUES
      (@id, @item_code, @name, @category, @size_id, @size_ml, @bottles_per_case, @barcode, @mrp, @selling_price, @stock, @synced_at)
    ON CONFLICT(size_id) DO UPDATE SET
      name=excluded.name, category=excluded.category, barcode=excluded.barcode,
      mrp=excluded.mrp, selling_price=excluded.selling_price, stock=excluded.stock,
      synced_at=excluded.synced_at
  `)
  const ts = nowMs()
  const upsert = db.transaction((items: ProductRow[]) => {
    for (const r of items) stmt.run({ ...r, synced_at: ts })
  })
  upsert(rows)
}

// ── Staff ─────────────────────────────────────────────────────────────────────
export type StaffRow = {
  id: number
  name: string
  role: string
  pin: string | null
  face_profile_json: string | null
  active: number
}

export function getStaff(db: Database.Database): StaffRow[] {
  return db.prepare(`SELECT * FROM staff_cache WHERE active=1 ORDER BY name`).all() as StaffRow[]
}

export function upsertStaff(db: Database.Database, rows: StaffRow[]): void {
  const stmt = db.prepare(`
    INSERT INTO staff_cache (id, name, role, pin, face_profile_json, active, synced_at)
    VALUES (@id, @name, @role, @pin, @face_profile_json, @active, @synced_at)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, role=excluded.role, pin=excluded.pin,
      face_profile_json=excluded.face_profile_json, active=excluded.active,
      synced_at=excluded.synced_at
  `)
  const ts = nowMs()
  const upsert = db.transaction((items: StaffRow[]) => {
    for (const r of items) stmt.run({ ...r, synced_at: ts })
  })
  upsert(rows)
}

// ── Sales ─────────────────────────────────────────────────────────────────────
export type SaleInput = {
  staff_id: number
  product_size_id: number
  product_name: string
  size_ml: number
  quantity: number
  selling_price: number
  total_amount: number
  payment_mode: string
  cash_amount?: number | null
  card_amount?: number | null
  upi_amount?: number | null
  scan_method: string
  customer_name?: string | null
}

export type SaleRow = SaleInput & {
  local_id: string
  sale_date: string
  sale_time: string
  server_id: number | null
  synced: number
  sync_error: string | null
  created_at: number
}

export function insertSale(db: Database.Database, input: SaleInput): SaleRow {
  const now = new Date()
  const row: SaleRow = {
    local_id: newId(),
    sale_date: now.toISOString().slice(0, 10),
    sale_time: now.toISOString(),
    server_id: null,
    synced: 0,
    sync_error: null,
    created_at: now.getTime(),
    ...input,
    cash_amount: input.cash_amount ?? null,
    card_amount: input.card_amount ?? null,
    upi_amount: input.upi_amount ?? null,
    customer_name: input.customer_name ?? null,
  }

  db.prepare(`
    INSERT INTO pending_sales
      (local_id,sale_date,sale_time,staff_id,product_size_id,product_name,size_ml,
       quantity,selling_price,total_amount,payment_mode,cash_amount,card_amount,
       upi_amount,scan_method,customer_name,synced,created_at)
    VALUES
      (@local_id,@sale_date,@sale_time,@staff_id,@product_size_id,@product_name,@size_ml,
       @quantity,@selling_price,@total_amount,@payment_mode,@cash_amount,@card_amount,
       @upi_amount,@scan_method,@customer_name,0,@created_at)
  `).run(row)

  // Optimistically deduct from local stock on normal sales.
  // VOID rows (quantity < 0) are logged for sync but do NOT touch local stock here —
  // voidSale() already restored the stock when the original sale was voided.
  if (input.product_size_id !== 0 && input.quantity > 0) {
    db.prepare(`UPDATE products_cache SET stock = MAX(0, stock - ?) WHERE size_id = ?`)
      .run(input.quantity, input.product_size_id)
  }

  return row
}

export function getTodaySales(db: Database.Database): SaleRow[] {
  return db.prepare(`SELECT * FROM pending_sales WHERE sale_date=? ORDER BY created_at DESC`)
    .all(todayStr()) as SaleRow[]
}

export function getPendingSales(db: Database.Database): SaleRow[] {
  return db.prepare(`SELECT * FROM pending_sales WHERE synced=0 ORDER BY created_at ASC LIMIT 100`).all() as SaleRow[]
}

export function markSaleSynced(db: Database.Database, localId: string, serverId: number): void {
  db.prepare(`UPDATE pending_sales SET synced=1, server_id=? WHERE local_id=?`).run(serverId, localId)
}

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function refundBreakupForSale(sale: SaleRow): { total: number; cash: number; card: number; upi: number } {
  const total = Math.abs(Number(sale.total_amount || 0))
  // Refunds are paid in cash, regardless of original payment mode.
  return { total: roundMoney(total), cash: roundMoney(total), card: 0, upi: 0 }
}

/**
 * Void a sale by local_id.
 * - Restores local stock for liquor items (product_size_id != 0)
 * - Deletes the pending_sales row so it never syncs to the cloud
 * - If the sale was already synced (server_id set), marks it voided instead
 *   so the sync engine can send a delete/void to the server.
 * Returns { ok, error? }
 */
export function voidSale(db: Database.Database, localId: string): { ok: boolean; error?: string } {
  const sale = db.prepare(`SELECT * FROM pending_sales WHERE local_id=?`).get(localId) as SaleRow | undefined
  if (!sale) return { ok: false, error: 'Sale not found' }
  if (sale.payment_mode === 'VOID' || sale.quantity <= 0) {
    return { ok: false, error: 'Sale already voided' }
  }

  db.transaction(() => {
    // Restore local stock
    if (sale.product_size_id !== 0) {
      db.prepare(`UPDATE products_cache SET stock = stock + ? WHERE size_id = ?`)
        .run(sale.quantity, sale.product_size_id)
    }

    const alreadySynced = sale.server_id != null || sale.synced === 1
    if (alreadySynced) {
      const now = new Date()
      const refund = refundBreakupForSale(sale)
      db.prepare(`
        INSERT INTO pending_sales
          (local_id,sale_date,sale_time,staff_id,product_size_id,product_name,size_ml,
           quantity,selling_price,total_amount,payment_mode,cash_amount,card_amount,
           upi_amount,scan_method,customer_name,synced,created_at)
        VALUES
          (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        newId(),
        now.toISOString().slice(0, 10),
        now.toISOString(),
        sale.staff_id,
        sale.product_size_id,
        sale.product_name,
        sale.size_ml,
        -Math.abs(sale.quantity),
        sale.selling_price,
        -refund.total,
        'VOID',
        refund.cash ? -refund.cash : null,
        refund.card ? -refund.card : null,
        refund.upi ? -refund.upi : null,
        'MANUAL',
        sale.customer_name ?? null,
        0,
        now.getTime(),
      )
    }

    // Delete original row. If unsynced, this cancels the sale before cloud sync.
    // If synced, the newly inserted VOID row will reconcile it on next push.
    db.prepare(`DELETE FROM pending_sales WHERE local_id=?`).run(localId)
  })()

  return { ok: true }
}

export function markSaleFailed(db: Database.Database, localId: string, error: string): void {
  db.prepare(`UPDATE pending_sales SET synced=2, sync_error=? WHERE local_id=?`).run(error, localId)
}

// ── Attendance ────────────────────────────────────────────────────────────────
export type AttendanceRow = {
  local_id: string
  staff_id: number
  staff_name: string
  date: string
  check_in: string | null
  check_out: string | null
  status: string
  server_id: number | null
  synced: number
  sync_error: string | null
  created_at: number
}

export function getAttendanceForDate(db: Database.Database, date: string): AttendanceRow[] {
  return db.prepare(`SELECT * FROM pending_attendance WHERE date=? ORDER BY check_in ASC`).all(date) as AttendanceRow[]
}

export function getAttendanceForStaffToday(db: Database.Database, staffId: number): AttendanceRow | null {
  return (db.prepare(`SELECT * FROM pending_attendance WHERE staff_id=? AND date=?`).get(staffId, todayStr()) as AttendanceRow | undefined) ?? null
}

export function checkInStaff(db: Database.Database, staffId: number, staffName: string): AttendanceRow {
  const existing = getAttendanceForStaffToday(db, staffId)
  if (existing) return existing  // Already checked in

  const now = new Date()
  const row: AttendanceRow = {
    local_id: newId(),
    staff_id: staffId,
    staff_name: staffName,
    date: now.toISOString().slice(0, 10),
    check_in: now.toISOString(),
    check_out: null,
    status: 'PRESENT',
    server_id: null,
    synced: 0,
    sync_error: null,
    created_at: now.getTime(),
  }

  db.prepare(`
    INSERT INTO pending_attendance
      (local_id,staff_id,staff_name,date,check_in,check_out,status,synced,created_at)
    VALUES
      (@local_id,@staff_id,@staff_name,@date,@check_in,@check_out,@status,0,@created_at)
  `).run(row)

  return row
}

export function checkOutStaff(db: Database.Database, staffId: number): AttendanceRow | null {
  const existing = getAttendanceForStaffToday(db, staffId)
  if (!existing || !existing.check_in) return null
  if (existing.check_out) return existing  // Already checked out

  const now = new Date().toISOString()
  db.prepare(`UPDATE pending_attendance SET check_out=?, synced=0, updated_at=? WHERE local_id=?`)
    .run(now, Date.now(), existing.local_id)

  return { ...existing, check_out: now }
}

export function getPendingAttendance(db: Database.Database): AttendanceRow[] {
  return db.prepare(`SELECT * FROM pending_attendance WHERE synced=0 ORDER BY created_at ASC LIMIT 100`).all() as AttendanceRow[]
}

export function markAttendanceSynced(db: Database.Database, localId: string, serverId: number): void {
  db.prepare(`UPDATE pending_attendance SET synced=1, server_id=? WHERE local_id=?`).run(serverId, localId)
}

// ── Expenses ──────────────────────────────────────────────────────────────────
export type ExpenseInput = {
  particulars: string
  category: string
  amount: number
  exp_date?: string
}

export type ExpenseRow = ExpenseInput & {
  local_id: string
  exp_date: string
  server_id: number | null
  synced: number
  sync_error: string | null
  created_at: number
}

export function insertExpense(db: Database.Database, input: ExpenseInput): ExpenseRow {
  const row: ExpenseRow = {
    local_id: newId(),
    exp_date: input.exp_date ?? todayStr(),
    particulars: input.particulars,
    category: input.category,
    amount: input.amount,
    server_id: null,
    synced: 0,
    sync_error: null,
    created_at: nowMs(),
  }

  db.prepare(`
    INSERT INTO pending_expenses (local_id,exp_date,particulars,category,amount,synced,created_at)
    VALUES (@local_id,@exp_date,@particulars,@category,@amount,0,@created_at)
  `).run(row)

  return row
}

export function getTodayExpenses(db: Database.Database): ExpenseRow[] {
  return db.prepare(`SELECT * FROM pending_expenses WHERE exp_date=? ORDER BY created_at DESC`).all(todayStr()) as ExpenseRow[]
}

export function getPendingExpenses(db: Database.Database): ExpenseRow[] {
  return db.prepare(`SELECT * FROM pending_expenses WHERE synced=0 ORDER BY created_at ASC LIMIT 100`).all() as ExpenseRow[]
}

export function markExpenseSynced(db: Database.Database, localId: string, serverId: number): void {
  db.prepare(`UPDATE pending_expenses SET synced=1, server_id=? WHERE local_id=?`).run(serverId, localId)
}

// ── Cash records ──────────────────────────────────────────────────────────────
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
  sync_error: string | null
  created_at: number
  updated_at: number
}

export function getTodayCashRecord(db: Database.Database): CashRecord | null {
  return (db.prepare(`SELECT * FROM pending_cash_records WHERE record_date=?`).get(todayStr()) as CashRecord | undefined) ?? null
}

export function upsertCashRecord(db: Database.Database, data: Partial<CashRecord> & { record_date: string }): CashRecord {
  const existing = db.prepare(`SELECT * FROM pending_cash_records WHERE record_date=?`).get(data.record_date) as CashRecord | undefined

  const now = nowMs()
  if (existing) {
    const merged = { ...existing, ...data, updated_at: now, synced: 0 }
    db.prepare(`
      UPDATE pending_cash_records SET
        opening_register=@opening_register, cash_sales=@cash_sales, expenses=@expenses,
        cash_to_locker=@cash_to_locker, closing_register=@closing_register,
        card_sales=@card_sales, upi_sales=@upi_sales, credit_sales=@credit_sales,
        credit_collected=@credit_collected, notes=@notes, synced=0, updated_at=@updated_at
      WHERE record_date=@record_date
    `).run(merged)
    return merged
  }

  const row: CashRecord = {
    local_id: newId(),
    record_date: data.record_date,
    opening_register: data.opening_register ?? 0,
    cash_sales: data.cash_sales ?? 0,
    expenses: data.expenses ?? 0,
    cash_to_locker: data.cash_to_locker ?? 0,
    closing_register: data.closing_register ?? 0,
    card_sales: data.card_sales ?? 0,
    upi_sales: data.upi_sales ?? 0,
    credit_sales: data.credit_sales ?? 0,
    credit_collected: data.credit_collected ?? 0,
    notes: data.notes ?? null,
    server_id: null,
    synced: 0,
    sync_error: null,
    created_at: now,
    updated_at: now,
  }
  db.prepare(`
    INSERT INTO pending_cash_records
      (local_id,record_date,opening_register,cash_sales,expenses,cash_to_locker,
       closing_register,card_sales,upi_sales,credit_sales,credit_collected,notes,
       synced,created_at,updated_at)
    VALUES
      (@local_id,@record_date,@opening_register,@cash_sales,@expenses,@cash_to_locker,
       @closing_register,@card_sales,@upi_sales,@credit_sales,@credit_collected,@notes,
       0,@created_at,@updated_at)
  `).run(row)
  return row
}

export function getPendingCashRecords(db: Database.Database): CashRecord[] {
  return db.prepare(`SELECT * FROM pending_cash_records WHERE synced=0 ORDER BY record_date ASC LIMIT 50`).all() as CashRecord[]
}

export function markCashSynced(db: Database.Database, localId: string, serverId: number): void {
  db.prepare(`UPDATE pending_cash_records SET synced=1, server_id=? WHERE local_id=?`).run(serverId, localId)
}

// ── Sync log ──────────────────────────────────────────────────────────────────
export function logSync(db: Database.Database, operation: string, entity: string, count: number, success: boolean, error?: string): void {
  db.prepare(`
    INSERT INTO sync_log (operation,entity,record_count,success,error,created_at)
    VALUES (?,?,?,?,?,?)
  `).run(operation, entity, count, success ? 1 : 0, error ?? null, nowMs())
}

// ── Misc items catalog ────────────────────────────────────────────────────────
export type MiscItemRow = {
  id: number
  name: string
  price: number
  barcode: string | null
  active: number
  created_at: number
  updated_at: number
}

export function getMiscItems(db: Database.Database): MiscItemRow[] {
  return db.prepare(`SELECT * FROM misc_items WHERE active=1 ORDER BY name`).all() as MiscItemRow[]
}

export function getMiscItemByBarcode(db: Database.Database, barcode: string): MiscItemRow | null {
  return (db.prepare(`SELECT * FROM misc_items WHERE barcode=? AND active=1`).get(barcode) as MiscItemRow | undefined) ?? null
}

export function saveMiscItem(
  db: Database.Database,
  item: { id?: number; name: string; price: number; barcode?: string | null }
): MiscItemRow {
  const now = nowMs()
  if (item.id) {
    db.prepare(
      `UPDATE misc_items SET name=?, price=?, barcode=?, updated_at=? WHERE id=?`
    ).run(item.name, item.price, item.barcode ?? null, now, item.id)
    return db.prepare(`SELECT * FROM misc_items WHERE id=?`).get(item.id) as MiscItemRow
  }
  const r = db.prepare(
    `INSERT INTO misc_items (name, price, barcode, active, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`
  ).run(item.name, item.price, item.barcode ?? null, now, now)
  return db.prepare(`SELECT * FROM misc_items WHERE id=?`).get(r.lastInsertRowid) as MiscItemRow
}

export function deleteMiscItem(db: Database.Database, id: number): void {
  db.prepare(`UPDATE misc_items SET active=0 WHERE id=?`).run(id)
}

// ── Misc sales (local-only, cashier earnings tracker) ─────────────────────────
export type MiscSaleInput = {
  staff_id: number
  item_name: string
  quantity: number
  price: number
  total: number
  payment_mode: string
}

export function insertMiscSale(db: Database.Database, input: MiscSaleInput): void {
  db.prepare(`
    INSERT INTO misc_sales (sale_date, staff_id, item_name, quantity, price, total, payment_mode, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(todayStr(), input.staff_id, input.item_name, input.quantity, input.price, input.total, input.payment_mode, nowMs())
}

export function getMiscSalesToday(db: Database.Database): { staff_id: number; item_name: string; quantity: number; total: number }[] {
  return db.prepare(`
    SELECT staff_id, item_name, SUM(quantity) AS quantity, SUM(total) AS total
    FROM misc_sales WHERE sale_date=?
    GROUP BY staff_id, item_name
    ORDER BY staff_id, item_name
  `).all(todayStr()) as { staff_id: number; item_name: string; quantity: number; total: number }[]
}

export function getMiscTotalsToday(db: Database.Database): { misc_revenue: number; misc_items_sold: number } {
  const row = db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS misc_revenue, COALESCE(SUM(quantity), 0) AS misc_items_sold
    FROM misc_sales WHERE sale_date=?
  `).get(todayStr()) as { misc_revenue: number; misc_items_sold: number }
  return row
}

// ── App settings ──────────────────────────────────────────────────────────────
export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key=?`).get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(`INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)`).run(key, value)
}

// ── Daily totals (computed from local sales) ──────────────────────────────────
export function getTodayTotals(db: Database.Database) {
  const date = todayStr()
  const row = db.prepare(`
    SELECT
      COUNT(CASE WHEN payment_mode != 'VOID' THEN 1 END) AS bill_count,
      SUM(CASE WHEN payment_mode != 'VOID' THEN quantity ELSE 0 END) AS total_bottles,
      SUM(total_amount)  AS gross_revenue,
      SUM(CASE
            WHEN payment_mode='CASH' THEN total_amount
            WHEN payment_mode='SPLIT' THEN COALESCE(cash_amount, 0)
        WHEN payment_mode='VOID' THEN total_amount
            ELSE 0
          END) AS cash_total,
      SUM(CASE
            WHEN payment_mode='CARD' THEN total_amount
            WHEN payment_mode='SPLIT' THEN COALESCE(card_amount, 0)
            ELSE 0
          END) AS card_total,
      SUM(CASE
            WHEN payment_mode='UPI' THEN total_amount
            WHEN payment_mode='SPLIT' THEN COALESCE(upi_amount, 0)
            ELSE 0
          END) AS upi_total
    FROM pending_sales
    WHERE sale_date=? AND synced != 99
  `).get(date) as {
    bill_count: number
    total_bottles: number
    gross_revenue: number
    cash_total: number
    card_total: number
    upi_total: number
  }
  return row
}
