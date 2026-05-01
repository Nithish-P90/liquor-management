import { AdjustmentType, Prisma } from "@prisma/client"

import { parseDateParam } from "@/lib/platform/dates"
import { DateString } from "@/lib/platform/types"

export type PrismaTransactionClient = Prisma.TransactionClient

export type StockOptions = {
  sessionId?: number
  upToDate?: DateString
}

export type StockResult = {
  openingBottles: number
  receiptBottles: number
  soldBottles: number
  adjustmentBottles: number
  pendingBottles: number
  totalBottles: number
}

const NEGATIVE_ADJUSTMENTS: AdjustmentType[] = ["BREAKAGE", "THEFT_WRITEOFF", "CORRECTION"]

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0
  if (typeof value === "number") return value
  return Number(value.toString())
}

async function resolveSession(
  tx: PrismaTransactionClient,
  sessionId?: number,
): Promise<{ id: number; periodStart: Date; periodEnd: Date } | null> {
  if (sessionId) {
    return tx.inventorySession.findUnique({
      where: { id: sessionId },
      select: { id: true, periodStart: true, periodEnd: true },
    })
  }

  return tx.inventorySession.findFirst({
    orderBy: [{ periodStart: "desc" }, { id: "desc" }],
    select: { id: true, periodStart: true, periodEnd: true },
  })
}

export async function calculateStock(
  tx: PrismaTransactionClient,
  productSizeId: number,
  options?: StockOptions,
): Promise<StockResult> {
  const session = await resolveSession(tx, options?.sessionId)

  if (!session) {
    return {
      openingBottles: 0,
      receiptBottles: 0,
      soldBottles: 0,
      adjustmentBottles: 0,
      pendingBottles: 0,
      totalBottles: 0,
    }
  }

  const periodStart = session.periodStart
  const maxDate = options?.upToDate ? parseDateParam(options.upToDate) : new Date()

  const opening = await tx.stockEntry.findUnique({
    where: {
      sessionId_productSizeId_entryType: {
        sessionId: session.id,
        productSizeId,
        entryType: "OPENING",
      },
    },
    select: { totalBottles: true },
  })

  const [receipts, sold, pending, positiveAdjustments, negativeAdjustments] = await Promise.all([
    tx.receiptItem.aggregate({
      _sum: { totalBottles: true },
      where: {
        productSizeId,
        receipt: {
          receivedDate: { gte: periodStart, lte: maxDate },
        },
      },
    }),
    tx.billLine.aggregate({
      _sum: { quantity: true },
      where: {
        productSizeId,
        sourceType: "LIQUOR",
        isVoidedLine: false,
        bill: {
          status: { in: ["COMMITTED", "TAB_FORCE_SETTLED"] },
          businessDate: { gte: periodStart, lte: maxDate },
        },
      },
    }),
    tx.billLine.aggregate({
      _sum: { quantity: true },
      where: {
        productSizeId,
        sourceType: "LIQUOR",
        isVoidedLine: false,
        bill: {
          status: "TAB_OPEN",
          businessDate: { gte: periodStart, lte: maxDate },
        },
      },
    }),
    tx.stockAdjustment.aggregate({
      _sum: { quantityBottles: true },
      where: {
        productSizeId,
        approved: true,
        adjustmentType: "RETURN",
        adjustmentDate: { gte: periodStart, lte: maxDate },
      },
    }),
    tx.stockAdjustment.aggregate({
      _sum: { quantityBottles: true },
      where: {
        productSizeId,
        approved: true,
        adjustmentType: { in: NEGATIVE_ADJUSTMENTS },
        adjustmentDate: { gte: periodStart, lte: maxDate },
      },
    }),
  ])

  const openingBottles = opening?.totalBottles ?? 0
  const receiptBottles = receipts._sum.totalBottles ?? 0
  const soldBottles = sold._sum.quantity ?? 0
  const pendingBottles = pending._sum.quantity ?? 0
  const adjustmentBottles = decimalToNumber(positiveAdjustments._sum.quantityBottles) - decimalToNumber(negativeAdjustments._sum.quantityBottles)

  const totalBottles = openingBottles + receiptBottles + adjustmentBottles - soldBottles - pendingBottles

  return {
    openingBottles,
    receiptBottles,
    soldBottles,
    adjustmentBottles,
    pendingBottles,
    totalBottles,
  }
}

export async function getAvailableStock(
  tx: PrismaTransactionClient,
  productSizeId: number,
  options?: StockOptions,
): Promise<number> {
  const result = await calculateStock(tx, productSizeId, options)
  return Math.max(0, result.totalBottles)
}

export function splitStock(totalBottles: number, bottlesPerCase: number): { cases: number; bottles: number } {
  if (bottlesPerCase <= 0) {
    return { cases: 0, bottles: Math.max(0, totalBottles) }
  }

  const safeTotal = Math.max(0, totalBottles)
  const cases = Math.floor(safeTotal / bottlesPerCase)
  const bottles = safeTotal % bottlesPerCase

  return { cases, bottles }
}

export function normalizeStockEntry(
  cases: number,
  bottles: number,
  bottlesPerCase: number,
): { cases: number; bottles: number; totalBottles: number } {
  const safeCases = Number.isFinite(cases) ? Math.max(0, Math.trunc(cases)) : 0
  const safeBottles = Number.isFinite(bottles) ? Math.max(0, Math.trunc(bottles)) : 0

  if (bottlesPerCase <= 0) {
    const totalBottles = safeCases + safeBottles
    return { cases: 0, bottles: totalBottles, totalBottles }
  }

  const totalBottles = safeCases * bottlesPerCase + safeBottles
  return {
    ...splitStock(totalBottles, bottlesPerCase),
    totalBottles,
  }
}
