import { MiscCategory, Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

type MiscCategorySummary = {
  items: number
  amount: number
  entries: number
}

export type MiscSalesSummary = {
  totalAmount: number
  items: number
  entries: number
  categories: Record<MiscCategory, MiscCategorySummary>
}

export type MiscSalesDayScope = {
  day: Date
  dayStart: Date
  nextDayStart: Date
  isoDate: string
}

export type MiscSaleRow = Prisma.MiscSaleGetPayload<{
  include: {
    item: true
    staff: {
      select: {
        id: true
        name: true
        role: true
      }
    }
  }
}>

export type NormalizedMiscSaleItem = {
  itemId: number
  quantity: number
}

const VALID_MISC_PAYMENT_MODES = ['CASH', 'CARD', 'UPI', 'SPLIT', 'CREDIT'] as const
type MiscPaymentMode = typeof VALID_MISC_PAYMENT_MODES[number]

function validMiscPaymentMode(v: unknown): MiscPaymentMode {
  if (VALID_MISC_PAYMENT_MODES.includes(v as MiscPaymentMode)) return v as MiscPaymentMode
  return 'CASH'
}

type CreateMiscSalesArgs = {
  saleDateInput?: string | null
  requestedStaffId?: unknown
  sessionStaffId?: unknown
  itemsInput: unknown
  paymentMode?: unknown  // payment mode used by the customer (defaults to CASH)
}

type CreatedMiscLine = {
  itemId: number
  quantity: number
  unitPrice: number
  totalAmount: number
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function asNumber(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function parsePositiveInt(value: unknown) {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}

function emptyCategorySummary(): Record<MiscCategory, MiscCategorySummary> {
  return {
    CIGARETTES: { items: 0, amount: 0, entries: 0 },
    SNACKS: { items: 0, amount: 0, entries: 0 },
    CUPS: { items: 0, amount: 0, entries: 0 },
  }
}

export function resolveMiscSalesDay(dateInput?: string | null): MiscSalesDayScope {
  let day: Date

  if (dateInput && dateInput.trim()) {
    const match = DATE_ONLY_RE.exec(dateInput.trim())
    if (!match) {
      throw new Error('Invalid date format. Use YYYY-MM-DD')
    }

    const year = Number(match[1])
    const month = Number(match[2])
    const dayOfMonth = Number(match[3])
    day = new Date(Date.UTC(year, month - 1, dayOfMonth, 12, 0, 0, 0))

    if (
      day.getUTCFullYear() !== year ||
      day.getUTCMonth() !== month - 1 ||
      day.getUTCDate() !== dayOfMonth
    ) {
      throw new Error('Invalid date value')
    }
  } else {
    day = toUtcNoonDate(new Date())
  }

  const dayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0, 0))
  const nextDayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1, 0, 0, 0, 0))
  const isoDate = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`

  return {
    day,
    dayStart,
    nextDayStart,
    isoDate,
  }
}

export function miscSaleWhereForScope(scope: MiscSalesDayScope, staffId?: number | null): Prisma.MiscSaleWhereInput {
  const where: Prisma.MiscSaleWhereInput = {
    saleDate: {
      gte: scope.dayStart,
      lt: scope.nextDayStart,
    },
  }

  if (staffId && staffId > 0) {
    where.staffId = staffId
  }

  return where
}

export function summarizeMiscSalesRows(rows: Array<{ quantity: number; totalAmount: unknown; item: { category: MiscCategory } }>): MiscSalesSummary {
  const categories = emptyCategorySummary()
  let totalAmount = 0
  let items = 0

  for (const row of rows) {
    const amount = asNumber(row.totalAmount)
    const qty = asNumber(row.quantity)
    totalAmount += amount
    items += qty
    categories[row.item.category].amount += amount
    categories[row.item.category].items += qty
    categories[row.item.category].entries += 1
  }

  return {
    totalAmount: round2(totalAmount),
    items,
    entries: rows.length,
    categories,
  }
}

export async function listMiscSalesForDate(options: {
  dateInput?: string | null
  staffId?: number | null
}) {
  const scope = resolveMiscSalesDay(options.dateInput)
  const rows = await prisma.miscSale.findMany({
    where: miscSaleWhereForScope(scope, options.staffId),
    include: {
      item: true,
      staff: { select: { id: true, name: true, role: true } },
    },
    orderBy: [{ saleTime: 'asc' }, { id: 'asc' }],
  })

  return {
    scope,
    rows,
    summary: summarizeMiscSalesRows(rows),
  }
}

export async function aggregateMiscSalesForScope(scope: MiscSalesDayScope, staffId?: number | null) {
  const agg = await prisma.miscSale.aggregate({
    where: miscSaleWhereForScope(scope, staffId),
    _sum: {
      totalAmount: true,
      quantity: true,
    },
    _count: { _all: true },
  })

  return {
    totalAmount: round2(asNumber(agg._sum.totalAmount)),
    items: asNumber(agg._sum.quantity),
    entries: agg._count._all,
  }
}

export function normalizeMiscSaleItems(itemsInput: unknown): NormalizedMiscSaleItem[] {
  if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
    throw new Error('At least one item is required')
  }

  const byId = new Map<number, number>()

  for (const raw of itemsInput as Array<Record<string, unknown>>) {
    const itemId = parsePositiveInt(raw?.itemId)
    const quantity = parsePositiveInt(raw?.quantity)
    if (!itemId || !quantity) {
      throw new Error('Invalid item payload')
    }
    byId.set(itemId, (byId.get(itemId) ?? 0) + quantity)
  }

  return Array.from(byId.entries())
    .map(([itemId, quantity]) => ({ itemId, quantity }))
    .sort((a, b) => a.itemId - b.itemId)
}

export async function resolveMiscSaleStaffId(args: {
  requestedStaffId?: unknown
  sessionStaffId?: unknown
}) {
  const candidates: number[] = []
  const requested = parsePositiveInt(args.requestedStaffId)
  if (requested) candidates.push(requested)
  const session = parsePositiveInt(args.sessionStaffId)
  if (session && !candidates.includes(session)) candidates.push(session)

  if (candidates.length > 0) {
    const matched = await prisma.staff.findFirst({
      where: {
        id: { in: candidates },
        active: true,
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    })
    if (matched) return matched.id
  }

  const fallbackCounter = await prisma.staff.findFirst({
    where: { active: true, role: { in: ['ADMIN', 'CASHIER'] } },
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  if (fallbackCounter) return fallbackCounter.id

  const fallbackAny = await prisma.staff.findFirst({
    where: { active: true },
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  if (fallbackAny) return fallbackAny.id

  throw new Error('No active staff found for misc sale attribution')
}

export async function createMiscSalesForDate(args: CreateMiscSalesArgs) {
  const scope = resolveMiscSalesDay(args.saleDateInput)
  const normalizedItems = normalizeMiscSaleItems(args.itemsInput)
  const [staffId, dbItems] = await Promise.all([
    resolveMiscSaleStaffId({ requestedStaffId: args.requestedStaffId, sessionStaffId: args.sessionStaffId }),
    prisma.miscItem.findMany({
      where: { id: { in: normalizedItems.map(item => item.itemId) } },
      select: { id: true, price: true },
    }),
  ])

  if (dbItems.length !== normalizedItems.length) {
    const dbIds = new Set(dbItems.map(item => item.id))
    const missing = normalizedItems.filter(item => !dbIds.has(item.itemId)).map(item => item.itemId)
    throw new Error(`Unknown misc item id(s): ${missing.join(', ')}`)
  }

  const priceById = new Map(dbItems.map(item => [item.id, round2(asNumber(item.price))]))
  const now = new Date()
  const paymentMode = validMiscPaymentMode(args.paymentMode)

  const rows: CreatedMiscLine[] = normalizedItems.map(item => {
    const unitPrice = priceById.get(item.itemId) ?? 0
    const totalAmount = round2(unitPrice * item.quantity)
    return {
      itemId: item.itemId,
      quantity: item.quantity,
      unitPrice,
      totalAmount,
    }
  })

  await prisma.miscSale.createMany({
    data: rows.map(row => ({
      staffId,
      itemId: row.itemId,
      saleDate: scope.day,
      saleTime: now,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      totalAmount: row.totalAmount,
      paymentMode,
    })),
  })

  return {
    scope,
    staffId,
    createdLines: rows,
    createdTotals: {
      totalAmount: round2(rows.reduce((sum, row) => sum + row.totalAmount, 0)),
      items: rows.reduce((sum, row) => sum + row.quantity, 0),
      entries: rows.length,
    },
  }
}
