import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'

export const dynamic = 'force-dynamic'

type RefundTotals = {
  cash: number
  card: number
  upi: number
  credit: number
  total: number
}

type VoidItemInput = {
  productSizeId: number
  quantityBottles: number
}

type SaleLike = {
  paymentMode: 'CASH' | 'CARD' | 'UPI' | 'CREDIT' | 'SPLIT'
  quantityBottles: number
  totalAmount: unknown
  cashAmount: unknown
  cardAmount: unknown
  upiAmount: unknown
}

type PositiveSaleLine = {
  id: number
  saleDate: Date
  saleTime: Date
  productSizeId: number
  quantityBottles: number
  sellingPrice: unknown
  paymentMode: SaleLike['paymentMode']
  totalAmount: unknown
  cashAmount: unknown
  cardAmount: unknown
  upiAmount: unknown
  billId: string | null
}

type VoidTxResult = {
  refund: RefundTotals
  createdRows: number
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function isRetryableWriteConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'
}

async function runWithRetry<T>(work: () => Promise<T>, maxAttempts = 4) {
  let attempt = 0
  let lastError: unknown = null
  while (attempt < maxAttempts) {
    try {
      return await work()
    } catch (error) {
      lastError = error
      attempt += 1
      if (!isRetryableWriteConflict(error) || attempt >= maxAttempts) throw error
      await new Promise(resolve => setTimeout(resolve, attempt * 75))
    }
  }
  throw lastError
}

function buildVoidReason(sourceSaleId: number, reason: string | null) {
  const tag = `void:sale#${sourceSaleId}`
  return reason ? `${reason} | ${tag}` : tag
}

function parseVoidedSaleId(reason: string | null | undefined) {
  if (!reason) return null
  const match = reason.match(/void:sale#(\d+)/i)
  if (!match) return null
  const saleId = Number(match[1])
  return Number.isInteger(saleId) && saleId > 0 ? saleId : null
}

function buildRemainingByLifo(lines: PositiveSaleLine[], totalVoided: number) {
  let remainingVoided = Math.max(0, totalVoided)
  const resolved: Array<{ line: PositiveSaleLine; remainingQty: number }> = []

  for (const line of lines) {
    let remainingQty = line.quantityBottles
    if (remainingVoided > 0) {
      const consumed = Math.min(remainingVoided, remainingQty)
      remainingQty -= consumed
      remainingVoided -= consumed
    }
    if (remainingQty > 0) resolved.push({ line, remainingQty })
  }

  return resolved
}

function getRefundBreakup(sale: SaleLike, voidQty: number): RefundTotals {
  const result: RefundTotals = { cash: 0, card: 0, upi: 0, credit: 0, total: 0 }
  const qty = Math.max(0, voidQty)
  if (!qty || sale.quantityBottles <= 0) return result

  let lineTotal = Number(sale.totalAmount ?? 0)
  if (!Number.isFinite(lineTotal) || Math.abs(lineTotal) < 0.000001) {
    lineTotal = Number(sale.cashAmount ?? 0) + Number(sale.cardAmount ?? 0) + Number(sale.upiAmount ?? 0)
  }

  const unitAmount = lineTotal / sale.quantityBottles
  const amount = unitAmount * qty
  // Refunds are paid out in cash, regardless of original payment mode.
  result.cash += amount
  result.total += amount
  return result
}

function addRefundFromSale(refund: RefundTotals, sale: SaleLike, voidQty: number) {
  const amount = getRefundBreakup(sale, voidQty)
  refund.cash += amount.cash
  refund.card += amount.card
  refund.upi += amount.upi
  refund.credit += amount.credit
  refund.total += amount.total
}

async function getNetVoidContext(
  tx: Prisma.TransactionClient,
  productSizeId: number,
  sourceStaffId: number,
  saleDate: Date,
) {
  const [positiveLines, voidLines] = await Promise.all([
    tx.sale.findMany({
      where: {
        saleDate,
        staffId: sourceStaffId,
        productSizeId,
        quantityBottles: { gt: 0 },
        paymentMode: { notIn: ['VOID', 'PENDING'] },
      },
      orderBy: [{ saleTime: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        saleDate: true,
        saleTime: true,
        productSizeId: true,
        quantityBottles: true,
        sellingPrice: true,
        paymentMode: true,
        totalAmount: true,
        cashAmount: true,
        cardAmount: true,
        upiAmount: true,
        billId: true,
      },
    }),
    tx.sale.findMany({
      where: {
        saleDate,
        productSizeId,
        paymentMode: 'VOID',
        quantityBottles: { lt: 0 },
      },
      select: { quantityBottles: true, overrideReason: true },
    }),
  ])

  const voidedBySaleId = new Map<number, number>()
  for (const row of voidLines) {
    const sourceSaleId = parseVoidedSaleId(row.overrideReason)
    if (!sourceSaleId) continue
    voidedBySaleId.set(sourceSaleId, (voidedBySaleId.get(sourceSaleId) ?? 0) + Math.abs(Number(row.quantityBottles ?? 0)))
  }

  const resolved = (positiveLines as PositiveSaleLine[])
    .map(line => ({ line, remainingQty: Math.max(0, line.quantityBottles - (voidedBySaleId.get(line.id) ?? 0)) }))
    .filter(x => x.remainingQty > 0)

  const available = resolved.reduce((sum, r) => sum + r.remainingQty, 0)
  return { resolved, available }
}

async function createVoidRow(tx: Prisma.TransactionClient, args: {
  source: PositiveSaleLine
  voidQty: number
  reason: string | null
  staffId: number
  now: Date
  today: Date
}) {
  const split = getRefundBreakup({
    paymentMode: args.source.paymentMode,
    quantityBottles: args.source.quantityBottles,
    totalAmount: args.source.totalAmount,
    cashAmount: args.source.cashAmount,
    cardAmount: args.source.cardAmount,
    upiAmount: args.source.upiAmount,
  }, args.voidQty)

  await tx.sale.create({
    data: {
      // Void is an event that happens now, so book it on today's saleDate.
      saleDate: args.today,
      saleTime: args.now,
      staffId: args.staffId,
      productSizeId: args.source.productSizeId,
      quantityBottles: -args.voidQty,
      sellingPrice: args.source.sellingPrice as number,
      totalAmount: -round2(split.total),
      paymentMode: 'VOID',
      cashAmount: split.cash !== 0 ? -round2(split.cash) : null,
      cardAmount: split.card !== 0 ? -round2(split.card) : null,
      upiAmount: split.upi !== 0 ? -round2(split.upi) : null,
      scanMethod: 'MANUAL',
      billId: args.source.billId,
      overrideReason: buildVoidReason(args.source.id, args.reason),
    },
  })

  return split
}

function normalizeVoidItems(items: unknown): VoidItemInput[] {
  if (!Array.isArray(items)) return []
  const grouped = new Map<number, number>()

  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const maybe = raw as { productSizeId?: unknown; quantityBottles?: unknown }
    const productSizeId = Number(maybe.productSizeId)
    const quantityBottles = Number(maybe.quantityBottles)
    if (!Number.isInteger(productSizeId) || productSizeId <= 0) continue
    if (!Number.isInteger(quantityBottles) || quantityBottles <= 0) continue
    grouped.set(productSizeId, (grouped.get(productSizeId) ?? 0) + quantityBottles)
  }

  return Array.from(grouped.entries()).map(([productSizeId, quantityBottles]) => ({
    productSizeId,
    quantityBottles,
  }))
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const saleId = Number(body?.saleId ?? 0)
  const selectedClerkStaffId = Number(body?.staffId ?? 0)
  const items = normalizeVoidItems(body?.items)
  const reason = typeof body?.reason === 'string' && body.reason.trim()
    ? body.reason.trim()
    : null

  if (!saleId && items.length === 0) {
    return NextResponse.json({ error: 'saleId or items[] is required' }, { status: 400 })
  }

  if (!saleId && (!Number.isInteger(selectedClerkStaffId) || selectedClerkStaffId <= 0)) {
    return NextResponse.json({ error: 'staffId is required for item-based returns' }, { status: 400 })
  }

  const staffId = parseInt((session.user as { id?: string } | undefined)?.id ?? '0')
  if (!Number.isInteger(staffId) || staffId <= 0) {
    return NextResponse.json({ error: 'Invalid session staff id' }, { status: 400 })
  }

  const now = new Date()
  const today = toUtcNoonDate(now)

  let result: VoidTxResult
  try {
    result = await runWithRetry(() =>
      prisma.$transaction(async tx => {
        const refund: RefundTotals = { cash: 0, card: 0, upi: 0, credit: 0, total: 0 }
        let createdRows = 0

        if (saleId) {
          const sale = await tx.sale.findUnique({
            where: { id: saleId },
            select: {
              id: true,
              staffId: true,
              saleDate: true,
              saleTime: true,
              productSizeId: true,
              quantityBottles: true,
              sellingPrice: true,
              paymentMode: true,
              totalAmount: true,
              cashAmount: true,
              cardAmount: true,
              upiAmount: true,
              billId: true,
            },
          })

          if (!sale || sale.quantityBottles <= 0 || sale.paymentMode === 'VOID' || sale.paymentMode === 'PENDING') {
            throw new Error('Sale not found or not voidable')
          }

          if (Number.isInteger(selectedClerkStaffId) && selectedClerkStaffId > 0 && sale.staffId !== selectedClerkStaffId) {
            throw new Error('Selected clerk does not match the sale clerk')
          }

          // Fetch candidate void rows and filter by exact saleId using regex (avoids
          // `contains: "void:sale#5"` matching "void:sale#50").
          const priorVoidRows = await tx.sale.findMany({
            where: {
              paymentMode: 'VOID',
              quantityBottles: { lt: 0 },
              overrideReason: { contains: `void:sale#${sale.id}` },
            },
            select: { quantityBottles: true, overrideReason: true },
          })
          const alreadyVoided = priorVoidRows
            .filter(r => parseVoidedSaleId(r.overrideReason) === sale.id)
            .reduce((sum, r) => sum + Math.abs(Number(r.quantityBottles ?? 0)), 0)
          const remainingQty = Math.max(0, sale.quantityBottles - alreadyVoided)
          if (remainingQty <= 0) throw new Error('Sale already fully voided')

          addRefundFromSale(refund, {
            paymentMode: sale.paymentMode,
            quantityBottles: sale.quantityBottles,
            totalAmount: sale.totalAmount,
            cashAmount: sale.cashAmount,
            cardAmount: sale.cardAmount,
            upiAmount: sale.upiAmount,
          }, remainingQty)

          await createVoidRow(tx, {
            source: sale as PositiveSaleLine,
            voidQty: remainingQty,
            reason,
            staffId,
            now,
            today,
          })
          createdRows += 1

          return { refund, createdRows }
        }

        for (const item of items) {
          const context = await getNetVoidContext(tx, item.productSizeId, selectedClerkStaffId, today)
          if (item.quantityBottles > context.available) {
            throw new Error(`Only ${context.available} sold bottles available to void for product #${item.productSizeId}`)
          }

          let remaining = item.quantityBottles
          for (const entry of context.resolved) {
            if (remaining <= 0) break
            const voidQty = Math.min(remaining, entry.remainingQty)
            remaining -= voidQty

            addRefundFromSale(refund, {
              paymentMode: entry.line.paymentMode,
              quantityBottles: entry.line.quantityBottles,
              totalAmount: entry.line.totalAmount,
              cashAmount: entry.line.cashAmount,
              cardAmount: entry.line.cardAmount,
              upiAmount: entry.line.upiAmount,
            }, voidQty)

            await createVoidRow(tx, {
              source: entry.line,
              voidQty,
              reason,
              staffId,
              now,
              today,
            })
            createdRows += 1
          }
        }

        return { refund, createdRows }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Void failed'
    if (message === 'Sale not found or not voidable') {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    if (message === 'Sale already fully voided') {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    if (message === 'Selected clerk does not match the sale clerk') {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    if (message.startsWith('Only ')) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    if (isRetryableWriteConflict(error)) {
      return NextResponse.json({ error: 'Temporary database contention while voiding. Please retry.' }, { status: 503 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    voidedLines: result.createdRows,
    refund: {
      cash: round2(result.refund.cash),
      card: round2(result.refund.card),
      upi: round2(result.refund.upi),
      credit: round2(result.refund.credit),
      total: round2(result.refund.total),
    },
  })
}
