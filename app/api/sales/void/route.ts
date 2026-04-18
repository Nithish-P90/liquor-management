import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
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

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function getRefundBreakup(sale: SaleLike, voidQty: number): RefundTotals {
  const result: RefundTotals = { cash: 0, card: 0, upi: 0, credit: 0, total: 0 }
  const qty = Math.max(0, voidQty)
  if (!qty || sale.quantityBottles <= 0) return result

  if (sale.paymentMode === 'SPLIT') {
    const ratio = qty / sale.quantityBottles
    const cash = Number(sale.cashAmount ?? 0) * ratio
    const card = Number(sale.cardAmount ?? 0) * ratio
    const upi = Number(sale.upiAmount ?? 0) * ratio
    result.cash += cash
    result.card += card
    result.upi += upi
    result.total += cash + card + upi
    return result
  }

  const unitAmount = Number(sale.totalAmount ?? 0) / sale.quantityBottles
  const amount = unitAmount * qty
  if (sale.paymentMode === 'CASH') result.cash += amount
  else if (sale.paymentMode === 'CARD') result.card += amount
  else if (sale.paymentMode === 'UPI') result.upi += amount
  else if (sale.paymentMode === 'CREDIT') result.credit += amount
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

function parseVoidedSaleId(reason: string | null | undefined) {
  if (!reason) return null
  const match = reason.match(/void:sale#(\d+)/i)
  if (!match) return null
  const saleId = Number(match[1])
  return Number.isInteger(saleId) && saleId > 0 ? saleId : null
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

  const body = await req.json()
  const saleId = Number(body?.saleId ?? 0)
  const items = normalizeVoidItems(body?.items)
  const reason = typeof body?.reason === 'string' && body.reason.trim()
    ? body.reason.trim()
    : null

  if (!saleId && items.length === 0) {
    return NextResponse.json({ error: 'saleId or items[] is required' }, { status: 400 })
  }

  const staffId = parseInt((session.user as { id?: string } | undefined)?.id ?? '0')
  if (!Number.isInteger(staffId) || staffId <= 0) {
    return NextResponse.json({ error: 'Invalid session staff id' }, { status: 400 })
  }

  const refund: RefundTotals = { cash: 0, card: 0, upi: 0, credit: 0, total: 0 }

  const now = new Date()
  const today = toUtcNoonDate(now)

  // Backward-compatible single-sale void
  if (saleId) {
    const sale = await prisma.sale.findUnique({ where: { id: saleId } })
    if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })

    const priorVoids = await prisma.sale.aggregate({
      where: {
        paymentMode: 'VOID',
        quantityBottles: { lt: 0 },
        overrideReason: { contains: `void:sale#${sale.id}` },
      },
      _sum: { quantityBottles: true },
    })
    const alreadyVoided = Math.abs(Number(priorVoids._sum.quantityBottles ?? 0))
    const remainingQty = Math.max(0, sale.quantityBottles - alreadyVoided)
    if (remainingQty <= 0) {
      return NextResponse.json({ error: 'Sale already fully voided' }, { status: 409 })
    }

    addRefundFromSale(refund, {
      paymentMode: sale.paymentMode,
      quantityBottles: sale.quantityBottles,
      totalAmount: sale.totalAmount,
      cashAmount: sale.cashAmount,
      cardAmount: sale.cardAmount,
      upiAmount: sale.upiAmount,
    }, remainingQty)

    const split = getRefundBreakup({
      paymentMode: sale.paymentMode,
      quantityBottles: sale.quantityBottles,
      totalAmount: sale.totalAmount,
      cashAmount: sale.cashAmount,
      cardAmount: sale.cardAmount,
      upiAmount: sale.upiAmount,
    }, remainingQty)

    // Insert a negative VOID row as audit trail instead of deleting the original
    await prisma.sale.create({
      data: {
        saleDate:        sale.saleDate,
        saleTime:        now,
        staffId:         staffId,
        productSizeId:   sale.productSizeId,
        quantityBottles: -remainingQty,
        sellingPrice:    sale.sellingPrice,
        totalAmount:     -round2(split.total),
        paymentMode:     'VOID',
        cashAmount:      split.cash !== 0 ? -round2(split.cash) : null,
        cardAmount:      split.card !== 0 ? -round2(split.card) : null,
        upiAmount:       split.upi !== 0 ? -round2(split.upi) : null,
        scanMethod:      'MANUAL',
        billId:          sale.billId,
        overrideReason:  reason ?? `void:sale#${sale.id}`,
      },
    })

    return NextResponse.json({
      success: true,
      voidedLines: 1,
      refund: {
        cash: round2(refund.cash),
        card: round2(refund.card),
        upi: round2(refund.upi),
        credit: round2(refund.credit),
        total: round2(refund.total),
      },
    })
  }

  // Batch/product-based void for quick returns
  try {
    await prisma.$transaction(async tx => {
      for (const item of items) {
        const [lines, existingVoids] = await Promise.all([
          tx.sale.findMany({
            where: {
              saleDate: today,
              productSizeId: item.productSizeId,
              quantityBottles: { gt: 0 },
              paymentMode: { not: 'VOID' },
            },
            orderBy: [{ saleTime: 'desc' }, { id: 'desc' }],
          }),
          tx.sale.findMany({
            where: {
              saleDate: today,
              productSizeId: item.productSizeId,
              paymentMode: 'VOID',
              quantityBottles: { lt: 0 },
            },
            select: { quantityBottles: true, overrideReason: true },
          }),
        ])

        const voidedBySaleId = new Map<number, number>()
        for (const v of existingVoids) {
          const id = parseVoidedSaleId(v.overrideReason)
          if (!id) continue
          voidedBySaleId.set(id, (voidedBySaleId.get(id) ?? 0) + Math.abs(v.quantityBottles))
        }

        const candidates = lines.map(line => {
          const alreadyVoided = voidedBySaleId.get(line.id) ?? 0
          const remainingQty = Math.max(0, line.quantityBottles - alreadyVoided)
          return { line, remainingQty }
        }).filter(x => x.remainingQty > 0)

        const available = candidates.reduce((sum, row) => sum + row.remainingQty, 0)
        if (item.quantityBottles > available) {
          throw new Error(`Only ${available} sold bottles available to void for product #${item.productSizeId}`)
        }

        let remaining = item.quantityBottles
        for (const { line, remainingQty } of candidates) {
          if (remaining <= 0) break
          const voidQty = Math.min(remaining, remainingQty)
          remaining -= voidQty

          const split = getRefundBreakup({
            paymentMode: line.paymentMode,
            quantityBottles: line.quantityBottles,
            totalAmount: line.totalAmount,
            cashAmount: line.cashAmount,
            cardAmount: line.cardAmount,
            upiAmount: line.upiAmount,
          }, voidQty)

          addRefundFromSale(refund, {
            paymentMode: line.paymentMode,
            quantityBottles: line.quantityBottles,
            totalAmount: line.totalAmount,
            cashAmount: line.cashAmount,
            cardAmount: line.cardAmount,
            upiAmount: line.upiAmount,
          }, voidQty)

          // Insert a negative VOID row as audit trail
          await tx.sale.create({
            data: {
              saleDate:        line.saleDate,
              saleTime:        now,
              staffId:         staffId,
              productSizeId:   line.productSizeId,
              quantityBottles: -voidQty,
              sellingPrice:    line.sellingPrice,
              totalAmount:     -round2(split.total),
              paymentMode:     'VOID',
              cashAmount:      split.cash !== 0 ? -round2(split.cash) : null,
              cardAmount:      split.card !== 0 ? -round2(split.card) : null,
              upiAmount:       split.upi !== 0 ? -round2(split.upi) : null,
              scanMethod:      'MANUAL',
              billId:          line.billId,
              overrideReason:  reason ?? `void:sale#${line.id}`,
            },
          })
        }
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Void failed'
    if (message.startsWith('Only ')) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    voidedLines: items.length,
    refund: {
      cash: round2(refund.cash),
      card: round2(refund.card),
      upi: round2(refund.upi),
      credit: round2(refund.credit),
      total: round2(refund.total),
    },
  })
}
