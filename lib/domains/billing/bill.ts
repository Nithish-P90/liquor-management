import { AttributionType, BillStatus, PaymentMode, Prisma, ScanMethod } from "@prisma/client"

import { parseDateParam, todayDateString } from "@/lib/platform/dates"
import { PrismaTransactionClient, getAvailableStock } from "@/lib/domains/inventory/stock"
import { applyClearanceSegments, reverseClearanceSegments, resolveRate } from "@/lib/domains/inventory/clearance"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DraftBillLine = {
  /** LIQUOR lines require productSizeId; MISC lines require miscItemId */
  productSizeId?: number
  miscItemId?: number
  itemNameSnapshot: string
  barcodeSnapshot?: string
  quantity: number
  scanMethod?: ScanMethod
  isManualOverride?: boolean
  overrideReason?: string
}

export type DraftPayment = {
  mode: PaymentMode
  amount: Prisma.Decimal | number
  reference?: string
}

export type CommitBillParams = {
  operatorId: number
  attributionType?: AttributionType
  clerkId?: number
  customerName?: string
  customerPhone?: string
  discountTotal?: Prisma.Decimal | number
  discountReason?: string
  notes?: string
  lines: DraftBillLine[]
  payments: DraftPayment[]
  /** If provided, commit this tab instead of creating a new bill */
  existingBillId?: number
}

export type VoidBillParams = {
  billId: number
  actorId: number
  reason: string
}

export type SettleTabParams = {
  billId: number
  actorId: number
  payments: DraftPayment[]
}

// ---------------------------------------------------------------------------
// Bill number
// ---------------------------------------------------------------------------

const BILL_COUNTER_KEY_PREFIX = "bill_counter"
const BILL_PREFIX = "MV"
const FISCAL_YEAR_START_MONTH = 4
const COUNTER_PAD = 5

function parseYearMonth(dateString: string): { year: number; month: number } {
  const [yearText, monthText] = dateString.split("-")
  const year = Number.parseInt(yearText ?? "", 10)
  const month = Number.parseInt(monthText ?? "", 10)

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid businessDate for bill numbering: ${dateString}`)
  }

  return { year, month }
}

function fiscalYearParts(businessDate: string): { startYear: number; endYearShort: string } {
  const { year, month } = parseYearMonth(businessDate)
  const startYear = month >= FISCAL_YEAR_START_MONTH ? year : year - 1
  const endYearShort = String((startYear + 1) % 100).padStart(2, "0")
  return { startYear, endYearShort }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002"
}

function parseCounter(value: string, key: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid bill counter value for ${key}: ${value}`)
  }
  return parsed
}

async function incrementCounter(tx: PrismaTransactionClient, counterKey: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ value: string }>>(
    Prisma.sql`
      UPDATE "Setting"
      SET "value" = (("value")::bigint + 1)::text
      WHERE "key" = ${counterKey}
      RETURNING "value"
    `,
  )

  if (rows.length === 1) {
    return parseCounter(rows[0].value, counterKey)
  }

  try {
    await tx.setting.create({ data: { key: counterKey, value: "1" } })
    return 1
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error
    }
  }

  const retryRows = await tx.$queryRaw<Array<{ value: string }>>(
    Prisma.sql`
      UPDATE "Setting"
      SET "value" = (("value")::bigint + 1)::text
      WHERE "key" = ${counterKey}
      RETURNING "value"
    `,
  )

  if (retryRows.length !== 1) {
    throw new Error(`Unable to increment bill counter for ${counterKey}`)
  }

  return parseCounter(retryRows[0].value, counterKey)
}

export async function nextBillNumber(
  tx: PrismaTransactionClient,
  businessDate: string = todayDateString(),
): Promise<string> {
  const { startYear, endYearShort } = fiscalYearParts(businessDate)
  const fiscalYearLabel = `${startYear}-${endYearShort}`
  const counterKey = `${BILL_COUNTER_KEY_PREFIX}_${startYear}_${endYearShort}`
  const sequence = await incrementCounter(tx, counterKey)
  return `${BILL_PREFIX}/${fiscalYearLabel}/${String(sequence).padStart(COUNTER_PAD, "0")}`
}

// ---------------------------------------------------------------------------
// Shared validators
// ---------------------------------------------------------------------------

function decimalFrom(value: Prisma.Decimal | number): Prisma.Decimal {
  return new Prisma.Decimal(value.toString())
}

function validateDraftLines(lines: DraftBillLine[]): void {
  if (lines.length === 0) {
    throw new Error("Bill must contain at least one line")
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const hasLiquor = line.productSizeId != null
    const hasMisc = line.miscItemId != null

    if (hasLiquor === hasMisc) {
      throw new Error(`Line ${i + 1} must specify exactly one of productSizeId or miscItemId`)
    }

    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error(`Line ${i + 1} quantity must be a positive integer`)
    }
  }
}

async function validateStockAvailability(
  tx: PrismaTransactionClient,
  lines: DraftBillLine[],
): Promise<void> {
  const requestedByVariant = new Map<number, number>()

  for (const line of lines) {
    if (line.productSizeId == null) continue
    requestedByVariant.set(
      line.productSizeId,
      (requestedByVariant.get(line.productSizeId) ?? 0) + line.quantity,
    )
  }

  const stockChecks: Array<Promise<void>> = []

  requestedByVariant.forEach((requested, productSizeId) => {
    stockChecks.push((async () => {
    const available = await getAvailableStock(tx, productSizeId, {})
    if (available < requested) {
      throw new Error(
        `Insufficient stock for productSizeId=${productSizeId}: available=${available}, requested=${requested}`,
      )
    }
    })())
  })

  await Promise.all(stockChecks)
}

function sumPayments(payments: DraftPayment[]): Prisma.Decimal {
  let total = new Prisma.Decimal(0)
  for (const payment of payments) {
    const amount = decimalFrom(payment.amount)
    if (amount.lessThanOrEqualTo(0)) {
      throw new Error("Payment amounts must be greater than zero")
    }
    total = total.plus(amount)
  }
  return total
}

function assertPaymentsMatch(
  payments: DraftPayment[],
  expected: Prisma.Decimal,
  operation: "commitBill" | "settleTab",
): void {
  if (expected.lessThan(0)) {
    throw new Error("Discount total cannot exceed gross total")
  }

  if (expected.equals(0) && payments.length === 0) {
    return
  }

  if (payments.length === 0) {
    throw new Error(`${operation} requires payments`) 
  }

  const paidTotal = sumPayments(payments)
  if (!paidTotal.equals(expected)) {
    throw new Error(
      `Payment total mismatch for ${operation}: expected=${expected.toString()}, received=${paidTotal.toString()}`,
    )
  }
}

// ---------------------------------------------------------------------------
// commitBill
// ---------------------------------------------------------------------------

export async function commitBill(
  tx: PrismaTransactionClient,
  params: CommitBillParams,
): Promise<number> {
  const businessDate = todayDateString()

  validateDraftLines(params.lines)
  await validateStockAvailability(tx, params.lines)

  // --- Resolve pricing (clearance vs normal) for each LIQUOR line ---
  type ResolvedLine = DraftBillLine & {
    unitPrice: Prisma.Decimal
    lineTotal: Prisma.Decimal
    clearanceBatchId?: number
  }

  const resolvedLines: ResolvedLine[] = []

  for (const line of params.lines) {
    if (line.productSizeId != null) {
      const segments = await resolveRate(tx, line.productSizeId, line.quantity)
      const resolvedQty = segments.reduce((sum, seg) => sum + seg.quantity, 0)

      if (segments.length === 0 || resolvedQty !== line.quantity) {
        throw new Error(
          `Invalid clearance segments for productSizeId=${line.productSizeId}: resolved=${resolvedQty}, requested=${line.quantity}`,
        )
      }

      if (segments.length === 1) {
        // Common case: single rate
        const unitPrice = new Prisma.Decimal(segments[0].rate.toString())
        resolvedLines.push({
          ...line,
          unitPrice,
          lineTotal: unitPrice.times(line.quantity),
          clearanceBatchId: segments[0].clearanceBatchId,
        })
      } else {
        // Split: one resolved line per rate segment
        for (const seg of segments) {
          if (seg.quantity <= 0) {
            throw new Error(`Invalid clearance segment quantity for productSizeId=${line.productSizeId}`)
          }
          const unitPrice = new Prisma.Decimal(seg.rate.toString())
          resolvedLines.push({
            ...line,
            quantity: seg.quantity,
            unitPrice,
            lineTotal: unitPrice.times(seg.quantity),
            clearanceBatchId: seg.clearanceBatchId,
          })
        }
      }
    } else {
      // MISC line — price from miscItem
      const miscItem = await tx.miscItem.findUniqueOrThrow({
        where: { id: line.miscItemId! },
        select: { price: true },
      })
      const unitPrice = miscItem.price
      resolvedLines.push({ ...line, unitPrice, lineTotal: unitPrice.times(line.quantity) })
    }
  }

  // --- Compute totals ---
  let ownerTotal = new Prisma.Decimal(0)
  let cashierTotal = new Prisma.Decimal(0)

  for (const l of resolvedLines) {
    if (l.productSizeId != null) {
      ownerTotal = ownerTotal.plus(l.lineTotal)
    } else {
      cashierTotal = cashierTotal.plus(l.lineTotal)
    }
  }

  const discountTotal = new Prisma.Decimal(params.discountTotal?.toString() ?? "0")
  const grossTotal = ownerTotal.plus(cashierTotal)
  const netCollectible = grossTotal.minus(discountTotal)

  assertPaymentsMatch(params.payments, netCollectible, "commitBill")

  // --- Write bill ---
  const billNumber = await nextBillNumber(tx, businessDate)

  const bill = await tx.bill.create({
    data: {
      billNumber,
      businessDate: parseDateParam(businessDate),
      operatorId: params.operatorId,
      attributionType: params.attributionType ?? AttributionType.COUNTER,
      clerkId: params.clerkId ?? null,
      status: BillStatus.COMMITTED,
      customerName: params.customerName ?? null,
      customerPhone: params.customerPhone ?? null,
      grossTotal,
      ownerTotal,
      cashierTotal,
      discountTotal,
      discountReason: params.discountReason ?? null,
      netCollectible,
      notes: params.notes ?? null,
    },
  })

  // --- Write bill lines ---
  for (let i = 0; i < resolvedLines.length; i++) {
    const line = resolvedLines[i]
    await tx.billLine.create({
      data: {
        billId: bill.id,
        lineNo: i + 1,
        entityType: line.productSizeId != null ? "OWNER" : "CASHIER",
        sourceType: line.productSizeId != null ? "LIQUOR" : "MISC",
        productSizeId: line.productSizeId ?? null,
        miscItemId: line.miscItemId ?? null,
        barcodeSnapshot: line.barcodeSnapshot ?? null,
        itemNameSnapshot: line.itemNameSnapshot,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
        scanMethod: line.scanMethod ?? ScanMethod.MANUAL,
        isManualOverride: line.isManualOverride ?? false,
        overrideReason: line.overrideReason ?? null,
      },
    })
  }

  // --- Write payment allocations ---
  for (const payment of params.payments) {
    await tx.paymentAllocation.create({
      data: {
        billId: bill.id,
        mode: payment.mode,
        amount: decimalFrom(payment.amount),
        reference: payment.reference ?? null,
      },
    })
  }

  // --- Consume clearance batches ---
  const clearanceSegments = resolvedLines
    .filter((l) => l.clearanceBatchId != null)
    .map((l) => ({ rate: l.unitPrice, quantity: l.quantity, clearanceBatchId: l.clearanceBatchId }))
  if (clearanceSegments.length > 0) {
    await applyClearanceSegments(tx, clearanceSegments)
  }

  // --- Audit ---
  await tx.auditEvent.create({
    data: {
      actorId: params.operatorId,
      eventType: "BILL_COMMITTED",
      entity: "Bill",
      entityId: bill.id,
      afterSnapshot: { billNumber: bill.billNumber, netCollectible: netCollectible.toString() },
    },
  })

  return bill.id
}

// ---------------------------------------------------------------------------
// voidBill
// ---------------------------------------------------------------------------

export async function voidBill(tx: PrismaTransactionClient, params: VoidBillParams): Promise<void> {
  const reason = params.reason.trim()
  if (!reason) {
    throw new Error("Void reason is required")
  }

  const bill = await tx.bill.findUniqueOrThrow({
    where: { id: params.billId },
    include: { lines: true },
  })

  if (bill.status !== BillStatus.COMMITTED) {
    throw new Error(`Cannot void bill ${params.billId}: status is ${bill.status}`)
  }

  await tx.bill.update({
    where: { id: params.billId },
    data: {
      status: BillStatus.VOIDED,
      voidedAt: new Date(),
      voidedById: params.actorId,
      voidReason: reason,
    },
  })

  // Reverse clearance consumption by scanning lines for clearance-priced items.
  // We detect clearance lines by comparing unitPrice to the standard sellingPrice.
  // For simplicity: re-query active clearance batches and reverse by batch date order.
  // A more precise approach would store clearanceBatchId on BillLine (future enhancement).
  // For now: reverse the resolveRate logic to reconstruct segments.
  const liquorLines = bill.lines.filter((l) => l.sourceType === "LIQUOR" && !l.isVoidedLine)
  const segmentsToReverse: Array<{ rate: Prisma.Decimal; quantity: number; clearanceBatchId?: number }> = []

  for (const line of liquorLines) {
    if (!line.productSizeId) continue
    const productSize = await tx.productSize.findUniqueOrThrow({
      where: { id: line.productSizeId },
      select: { sellingPrice: true },
    })
    // If the unit price differs from current sellingPrice, it was a clearance line.
    // Find the batch that had this rate at bill creation time (best-effort FIFO).
    if (!line.unitPrice.equals(productSize.sellingPrice)) {
      const batch = await tx.clearanceBatch.findFirst({
        where: {
          productSizeId: line.productSizeId,
          clearanceRate: line.unitPrice,
          status: { in: ["ACTIVE", "EXHAUSTED"] },
        },
        orderBy: { createdAt: "asc" },
      })
      if (batch) {
        segmentsToReverse.push({ rate: line.unitPrice, quantity: line.quantity, clearanceBatchId: batch.id })
      }
    }
  }

  if (segmentsToReverse.length > 0) {
    await reverseClearanceSegments(tx, segmentsToReverse)
  }

  await tx.auditEvent.create({
    data: {
      actorId: params.actorId,
      eventType: "BILL_VOIDED",
      entity: "Bill",
      entityId: params.billId,
      reason,
      afterSnapshot: { reason },
    },
  })
}

// ---------------------------------------------------------------------------
// settleTab
// ---------------------------------------------------------------------------

export async function settleTab(
  tx: PrismaTransactionClient,
  params: SettleTabParams,
): Promise<void> {
  const bill = await tx.bill.findUniqueOrThrow({
    where: { id: params.billId },
    select: { status: true, netCollectible: true },
  })

  if (bill.status !== BillStatus.TAB_OPEN) {
    throw new Error(`Cannot settle bill ${params.billId}: status is ${bill.status}`)
  }

  assertPaymentsMatch(params.payments, bill.netCollectible, "settleTab")

  await tx.bill.update({
    where: { id: params.billId },
    data: { status: BillStatus.COMMITTED },
  })

  for (const payment of params.payments) {
    await tx.paymentAllocation.create({
      data: {
        billId: params.billId,
        mode: payment.mode,
        amount: decimalFrom(payment.amount),
        reference: payment.reference ?? null,
      },
    })
  }

  await tx.auditEvent.create({
    data: {
      actorId: params.actorId,
      eventType: "TAB_SETTLED",
      entity: "Bill",
      entityId: params.billId,
    },
  })
}

// ---------------------------------------------------------------------------
// openTab — same as commitBill but saves as TAB_OPEN
// ---------------------------------------------------------------------------

export async function openTab(
  tx: PrismaTransactionClient,
  params: Omit<CommitBillParams, "payments">,
): Promise<number> {
  const businessDate = todayDateString()

  validateDraftLines(params.lines)
  await validateStockAvailability(tx, params.lines)

  type ResolvedLine = DraftBillLine & {
    unitPrice: Prisma.Decimal
    lineTotal: Prisma.Decimal
    clearanceBatchId?: number
  }

  const resolvedLines: ResolvedLine[] = []

  for (const line of params.lines) {
    if (line.productSizeId != null) {
      const segments = await resolveRate(tx, line.productSizeId, line.quantity)
      const resolvedQty = segments.reduce((sum, seg) => sum + seg.quantity, 0)

      if (segments.length === 0 || resolvedQty !== line.quantity) {
        throw new Error(
          `Invalid clearance segments for productSizeId=${line.productSizeId}: resolved=${resolvedQty}, requested=${line.quantity}`,
        )
      }

      if (segments.length === 1) {
        const unitPrice = new Prisma.Decimal(segments[0].rate.toString())
        resolvedLines.push({
          ...line,
          unitPrice,
          lineTotal: unitPrice.times(line.quantity),
          clearanceBatchId: segments[0].clearanceBatchId,
        })
      } else {
        for (const seg of segments) {
          if (seg.quantity <= 0) {
            throw new Error(`Invalid clearance segment quantity for productSizeId=${line.productSizeId}`)
          }
          const unitPrice = new Prisma.Decimal(seg.rate.toString())
          resolvedLines.push({
            ...line,
            quantity: seg.quantity,
            unitPrice,
            lineTotal: unitPrice.times(seg.quantity),
            clearanceBatchId: seg.clearanceBatchId,
          })
        }
      }
    } else {
      const miscItem = await tx.miscItem.findUniqueOrThrow({
        where: { id: line.miscItemId! },
        select: { price: true },
      })
      resolvedLines.push({ ...line, unitPrice: miscItem.price, lineTotal: miscItem.price.times(line.quantity) })
    }
  }

  let ownerTotal = new Prisma.Decimal(0)
  let cashierTotal = new Prisma.Decimal(0)
  for (const l of resolvedLines) {
    if (l.productSizeId != null) ownerTotal = ownerTotal.plus(l.lineTotal)
    else cashierTotal = cashierTotal.plus(l.lineTotal)
  }

  const discountTotal = new Prisma.Decimal(params.discountTotal?.toString() ?? "0")
  const grossTotal = ownerTotal.plus(cashierTotal)
  const netCollectible = grossTotal.minus(discountTotal)

  if (netCollectible.lessThan(0)) {
    throw new Error("Discount total cannot exceed gross total")
  }

  const billNumber = await nextBillNumber(tx, businessDate)

  const bill = await tx.bill.create({
    data: {
      billNumber,
      businessDate: parseDateParam(businessDate),
      operatorId: params.operatorId,
      attributionType: params.attributionType ?? AttributionType.COUNTER,
      clerkId: params.clerkId ?? null,
      status: BillStatus.TAB_OPEN,
      customerName: params.customerName ?? null,
      customerPhone: params.customerPhone ?? null,
      grossTotal,
      ownerTotal,
      cashierTotal,
      discountTotal,
      discountReason: params.discountReason ?? null,
      netCollectible,
      notes: params.notes ?? null,
    },
  })

  for (let i = 0; i < resolvedLines.length; i++) {
    const line = resolvedLines[i]
    await tx.billLine.create({
      data: {
        billId: bill.id,
        lineNo: i + 1,
        entityType: line.productSizeId != null ? "OWNER" : "CASHIER",
        sourceType: line.productSizeId != null ? "LIQUOR" : "MISC",
        productSizeId: line.productSizeId ?? null,
        miscItemId: line.miscItemId ?? null,
        barcodeSnapshot: line.barcodeSnapshot ?? null,
        itemNameSnapshot: line.itemNameSnapshot,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
        scanMethod: line.scanMethod ?? ScanMethod.MANUAL,
        isManualOverride: line.isManualOverride ?? false,
        overrideReason: line.overrideReason ?? null,
      },
    })
  }

  // Consume clearance batches at tab-open time (tabs already deduct stock)
  const clearanceSegments = resolvedLines
    .filter((l) => l.clearanceBatchId != null)
    .map((l) => ({ rate: l.unitPrice, quantity: l.quantity, clearanceBatchId: l.clearanceBatchId }))
  if (clearanceSegments.length > 0) {
    await applyClearanceSegments(tx, clearanceSegments)
  }

  await tx.auditEvent.create({
    data: {
      actorId: params.operatorId,
      eventType: "TAB_OPENED",
      entity: "Bill",
      entityId: bill.id,
      afterSnapshot: { billNumber: bill.billNumber },
    },
  })

  return bill.id
}
