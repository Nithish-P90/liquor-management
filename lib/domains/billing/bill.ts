import { AttributionType, BillStatus, GallaEventType, PaymentMode, Prisma, ScanMethod } from "@prisma/client"

import { parseDateParam, todayDateString } from "@/lib/platform/dates"
import { PrismaTransactionClient, getAvailableStock } from "@/lib/domains/inventory/stock"
import { applyClearanceSegments, reverseClearanceSegments, resolveRate } from "@/lib/domains/inventory/clearance"
import { emitGallaEvent } from "@/lib/domains/cash/galla"

export const REVENUE_BILL_STATUSES = [BillStatus.COMMITTED, BillStatus.TAB_SETTLED, BillStatus.TAB_FORCE_SETTLED]

/**
 * Prisma 'where' clause for bills that contribute to revenue/sales.
 * Includes: COMMITTED/SETTLED bills, and VOIDED returns (negative collectible).
 */
export const REVENUE_BILL_WHERE: Prisma.BillWhereInput = {
  OR: [
    { status: { in: REVENUE_BILL_STATUSES } },
    { status: BillStatus.VOIDED, netCollectible: { lt: 0 } }
  ]
}

/**
 * Prisma 'where' clause for bill lines that contribute to net sales volume.
 * Includes: non-voided lines on committed bills, and negative lines on return bills.
 */
export const REVENUE_LINE_WHERE: Prisma.BillLineWhereInput = {
  OR: [
    { bill: { status: { in: REVENUE_BILL_STATUSES } }, isVoidedLine: false },
    { bill: { status: BillStatus.VOIDED }, quantity: { lt: 0 } }
  ]
}

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
    isThirdPartySnapshot?: boolean
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
      // MISC line — price from miscItem, snapshot third-party flag for audit
      const miscItem = await tx.miscItem.findUniqueOrThrow({
        where: { id: line.miscItemId! },
        select: { price: true, isThirdParty: true },
      })
      const unitPrice = miscItem.price
      resolvedLines.push({
        ...line,
        unitPrice,
        lineTotal: unitPrice.times(line.quantity),
        isThirdPartySnapshot: miscItem.isThirdParty,
      })
    }
  }

  // --- Compute totals ---
  let ownerTotal = new Prisma.Decimal(0)
  let cashierTotal = new Prisma.Decimal(0)
  let thirdPartyTotal = new Prisma.Decimal(0)

  for (const l of resolvedLines) {
    if (l.productSizeId != null) {
      ownerTotal = ownerTotal.plus(l.lineTotal)
    } else {
      cashierTotal = cashierTotal.plus(l.lineTotal)
      if (l.isThirdPartySnapshot) {
        thirdPartyTotal = thirdPartyTotal.plus(l.lineTotal)
      }
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
      thirdPartyTotal,
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
        isThirdPartySnapshot: line.isThirdPartySnapshot ?? false,
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

  // Emit SALE_CASH to galla immediately so register balance reflects real-time sales
  const cashPaid = params.payments
    .filter((p) => p.mode === PaymentMode.CASH)
    .reduce((sum, p) => sum.plus(decimalFrom(p.amount)), new Prisma.Decimal(0))

  if (cashPaid.greaterThan(0)) {
    await emitGallaEvent(tx, {
      businessDate: parseDateParam(businessDate),
      eventType: GallaEventType.SALE_CASH,
      amount: cashPaid,
      reference: `BILL ${bill.billNumber}`,
      billId: bill.id,
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
    include: { lines: true, payments: true },
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

  // IMPORTANT: Mark all lines as voided so they are excluded from stock and sales sums
  await tx.billLine.updateMany({
    where: { billId: params.billId },
    data: { isVoidedLine: true }
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

  const refundCash = (bill.payments ?? [])
    .filter((payment) => payment.mode === PaymentMode.CASH)
    .reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0))

  if (refundCash.greaterThan(0)) {
    await emitGallaEvent(tx, {
      businessDate: parseDateParam(todayDateString()),
      eventType: GallaEventType.REFUND_CASH,
      amount: refundCash,
      reference: `VOID ${bill.billNumber}`,
      billId: bill.id,
    })
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

  // Emit SALE_CASH to galla so register balance reflects tab settlement
  const tabCashPaid = params.payments
    .filter((p) => p.mode === PaymentMode.CASH)
    .reduce((sum, p) => sum.plus(decimalFrom(p.amount)), new Prisma.Decimal(0))

  if (tabCashPaid.greaterThan(0)) {
    await emitGallaEvent(tx, {
      businessDate: parseDateParam(todayDateString()),
      eventType: GallaEventType.SALE_CASH,
      amount: tabCashPaid,
      reference: `TAB ${params.billId}`,
      billId: params.billId,
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
    isThirdPartySnapshot?: boolean
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
        select: { price: true, isThirdParty: true },
      })
      resolvedLines.push({
        ...line,
        unitPrice: miscItem.price,
        lineTotal: miscItem.price.times(line.quantity),
        isThirdPartySnapshot: miscItem.isThirdParty,
      })
    }
  }

  let ownerTotal = new Prisma.Decimal(0)
  let cashierTotal = new Prisma.Decimal(0)
  let thirdPartyTotal = new Prisma.Decimal(0)
  for (const l of resolvedLines) {
    if (l.productSizeId != null) {
      ownerTotal = ownerTotal.plus(l.lineTotal)
    } else {
      cashierTotal = cashierTotal.plus(l.lineTotal)
      if (l.isThirdPartySnapshot) thirdPartyTotal = thirdPartyTotal.plus(l.lineTotal)
    }
  }

  const discountTotal = new Prisma.Decimal(params.discountTotal?.toString() ?? "0")
  const grossTotal = ownerTotal.plus(cashierTotal)
  const netCollectible = grossTotal.minus(discountTotal)

  if (netCollectible.lessThan(0)) {
    throw new Error("Discount total cannot exceed gross total")
  }

  if (params.existingBillId != null) {
    const existingBill = await tx.bill.findUniqueOrThrow({
      where: { id: params.existingBillId },
      select: {
        id: true,
        status: true,
        billNumber: true,
        grossTotal: true,
        ownerTotal: true,
        cashierTotal: true,
        thirdPartyTotal: true,
        discountTotal: true,
        netCollectible: true,
        lines: { select: { id: true } },
      },
    })

    if (existingBill.status !== BillStatus.TAB_OPEN) {
      throw new Error(`Cannot add to bill ${existingBill.billNumber}: status is ${existingBill.status}`)
    }

    for (let i = 0; i < resolvedLines.length; i++) {
      const line = resolvedLines[i]
      await tx.billLine.create({
        data: {
          billId: existingBill.id,
          lineNo: existingBill.lines.length + i + 1,
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
          isThirdPartySnapshot: line.isThirdPartySnapshot ?? false,
        },
      })
    }

    const updatedOwnerTotal = existingBill.ownerTotal.plus(ownerTotal)
    const updatedCashierTotal = existingBill.cashierTotal.plus(cashierTotal)
    const updatedThirdPartyTotal = existingBill.thirdPartyTotal.plus(thirdPartyTotal)
    const updatedGrossTotal = existingBill.grossTotal.plus(grossTotal)
    const updatedNetCollectible = existingBill.netCollectible.plus(grossTotal)

    await tx.bill.update({
      where: { id: existingBill.id },
      data: {
        grossTotal: updatedGrossTotal,
        ownerTotal: updatedOwnerTotal,
        cashierTotal: updatedCashierTotal,
        thirdPartyTotal: updatedThirdPartyTotal,
        netCollectible: updatedNetCollectible,
      },
    })

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
        entityId: existingBill.id,
        afterSnapshot: { billNumber: existingBill.billNumber, appended: true },
      },
    })

    return existingBill.id
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
      thirdPartyTotal,
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
        isThirdPartySnapshot: line.isThirdPartySnapshot ?? false,
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

// ---------------------------------------------------------------------------
// returnItem
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// commitReturn — scan-to-cart return workflow
// ---------------------------------------------------------------------------
// Design: A return is NOT a negative sale. It is a separate operational event:
//   1. VOIDED bill (audit trail only — excluded from all sales aggregates)
//   2. StockAdjustment(RETURN) per liquor item (puts bottles back in inventory)
//   3. GallaEvent(REFUND_CASH) (subtracts cash from register)
// ---------------------------------------------------------------------------

export async function commitReturn(
  tx: PrismaTransactionClient,
  params: {
    operatorId: number
    clerkId: number
    reason: string
    lines: Array<{
      productSizeId?: number
      miscItemId?: number
      itemNameSnapshot: string
      quantity: number
      unitPrice: number | Prisma.Decimal
    }>
  }
): Promise<{ billNumber: string }> {
  const businessDate = todayDateString()
  const businessDateParsed = parseDateParam(businessDate)
  const reason = params.reason.trim() || "Customer Return"

  if (params.lines.length === 0) {
    throw new Error("Return must contain at least one item")
  }

  // 1. Validate each item was actually sold in sufficient quantity
  //    Net returnable = (total sold on COMMITTED bills) - (already returned via StockAdjustment)
  for (const line of params.lines) {
    const lineIdentity = line.productSizeId
      ? { productSizeId: line.productSizeId, sourceType: "LIQUOR" as const }
      : line.miscItemId
        ? { miscItemId: line.miscItemId, sourceType: "MISC" as const }
        : null

    if (!lineIdentity) {
      throw new Error(`Return line is missing item reference: ${line.itemNameSnapshot}`)
    }

    const clerkSoldData = await tx.billLine.aggregate({
      where: {
        ...lineIdentity,
        isVoidedLine: false,
        quantity: { gt: 0 },
        bill: { status: { in: ["COMMITTED", "TAB_FORCE_SETTLED"] }, clerkId: params.clerkId },
      },
      _sum: { quantity: true },
    })
    const clerkSold = clerkSoldData._sum.quantity ?? 0

    const clerkReturnedData = await tx.billLine.aggregate({
      where: {
        ...lineIdentity,
        isVoidedLine: true,
        quantity: { lt: 0 },
        bill: { status: BillStatus.VOIDED, clerkId: params.clerkId },
      },
      _sum: { quantity: true },
    })
    const clerkReturned = Math.abs(clerkReturnedData._sum.quantity ?? 0)
    const clerkNetReturnable = clerkSold - clerkReturned

    if (clerkNetReturnable < line.quantity) {
      throw new Error(
        `Return denied for ${line.itemNameSnapshot}: this clerk has only ${clerkNetReturnable} eligible for return.`
      )
    }

    if (!line.productSizeId) continue // misc items skip stock validation

    // Total sold (positive quantities on non-voided lines of COMMITTED bills)
    const soldData = await tx.billLine.aggregate({
      where: {
        productSizeId: line.productSizeId,
        isVoidedLine: false,
        quantity: { gt: 0 },
        bill: { status: { in: ["COMMITTED", "TAB_FORCE_SETTLED"] } }
      },
      _sum: { quantity: true }
    })
    const totalSold = soldData._sum.quantity ?? 0

    // Already returned (positive quantities of non-voided lines on VOIDED bills with negative totals)
    const returnedData = await tx.billLine.aggregate({
      where: {
        productSizeId: line.productSizeId,
        isVoidedLine: false,
        quantity: { lt: 0 },
        bill: { status: BillStatus.VOIDED, netCollectible: { lt: 0 } }
      },
      _sum: { quantity: true }
    })
    const totalReturned = Math.abs(returnedData._sum.quantity ?? 0)

    const netReturnable = totalSold - totalReturned
    if (netReturnable < line.quantity) {
      throw new Error(
        `Cannot return ${line.quantity}x ${line.itemNameSnapshot}: only ${netReturnable} eligible for return (${totalSold} sold, ${totalReturned} already returned).`
      )
    }
  }

  // 2. Calculate totals (all positive — they represent the refund amount)
  let ownerAmt = new Prisma.Decimal(0)
  let cashierAmt = new Prisma.Decimal(0)
  for (const line of params.lines) {
    const lineAmt = new Prisma.Decimal(line.unitPrice.toString()).times(line.quantity)
    if (line.productSizeId) ownerAmt = ownerAmt.plus(lineAmt)
    else cashierAmt = cashierAmt.plus(lineAmt)
  }
  const totalAmount = ownerAmt.plus(cashierAmt)

  // 3. Create audit-trail bill (VOIDED status, negative values for net sales parity)
  const baseBillNumber = await nextBillNumber(tx, businessDate)
  const billNumber = `${baseBillNumber}-RET`
  const bill = await tx.bill.create({
    data: {
      billNumber,
      businessDate: businessDateParsed,
      operatorId: params.operatorId,
      clerkId: params.clerkId,
      attributionType: params.clerkId ? "CLERK" : "COUNTER",
      status: BillStatus.VOIDED,
      voidReason: reason,
      voidedById: params.operatorId,
      voidedAt: new Date(),
      grossTotal: totalAmount.negated(),
      ownerTotal: ownerAmt.negated(),
      cashierTotal: cashierAmt.negated(),
      netCollectible: totalAmount.negated(),
    },
  })

  // 4. Create bill lines (negative quantities for net sales aggregation)
  for (let i = 0; i < params.lines.length; i++) {
    const l = params.lines[i]
    const lineTotal = new Prisma.Decimal(l.unitPrice.toString()).times(l.quantity)

    await tx.billLine.create({
      data: {
        billId: bill.id,
        lineNo: i + 1,
        entityType: l.productSizeId ? "OWNER" : "CASHIER",
        sourceType: l.productSizeId ? "LIQUOR" : "MISC",
        productSizeId: l.productSizeId,
        miscItemId: l.miscItemId,
        itemNameSnapshot: l.itemNameSnapshot,
        quantity: -Math.abs(l.quantity), // Store as negative for net sales aggregation
        unitPrice: new Prisma.Decimal(l.unitPrice.toString()),
        lineTotal: lineTotal.negated(),
        isVoidedLine: false, // Set to false so it contributes to the net-sales/net-stock sum
      }
    })
  }

  // 5. Audit event (StockAdjustment is no longer needed as calculateStock now handles returns via BillLines)

  // 5b. Create negative PaymentAllocation so Net Distribution aggregates correctly
  await tx.paymentAllocation.create({
    data: {
      billId: bill.id,
      mode: PaymentMode.CASH,
      amount: totalAmount.negated(),
      reference: `RETURN ${bill.billNumber}`,
    },
  })

  // 6. Emit Galla refund → subtracts cash from register
  await emitGallaEvent(tx, {
    businessDate: businessDateParsed,
    eventType: GallaEventType.REFUND_CASH,
    amount: totalAmount,
    reference: `RETURN: ${bill.billNumber}`,
    billId: bill.id,
  })

  // 7. Audit event
  await tx.auditEvent.create({
    data: {
      actorId: params.operatorId,
      eventType: "RETURN_PROCESSED",
      entity: "Bill",
      entityId: bill.id,
      reason,
      afterSnapshot: {
        billNumber: bill.billNumber,
        totalRefund: totalAmount.toString(),
        items: params.lines.map(l => ({
          name: l.itemNameSnapshot,
          qty: l.quantity,
          unitPrice: l.unitPrice.toString(),
        })),
      },
    }
  })

  return { billNumber: bill.billNumber }
}
