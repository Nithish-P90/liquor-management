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

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function addRefundFromSale(refund: RefundTotals, sale: {
  paymentMode: 'CASH' | 'CARD' | 'UPI' | 'CREDIT' | 'SPLIT'
  quantityBottles: number
  totalAmount: unknown
  cashAmount: unknown
  cardAmount: unknown
  upiAmount: unknown
}, voidQty: number) {
  const qty = Math.max(0, voidQty)
  if (!qty || sale.quantityBottles <= 0) return

  if (sale.paymentMode === 'SPLIT') {
    const ratio = qty / sale.quantityBottles
    const cash = Number(sale.cashAmount ?? 0) * ratio
    const card = Number(sale.cardAmount ?? 0) * ratio
    const upi = Number(sale.upiAmount ?? 0) * ratio
    refund.cash += cash
    refund.card += card
    refund.upi += upi
    refund.total += cash + card + upi
    return
  }

  const unitAmount = Number(sale.totalAmount ?? 0) / sale.quantityBottles
  const amount = unitAmount * qty
  if (sale.paymentMode === 'CASH') refund.cash += amount
  else if (sale.paymentMode === 'CARD') refund.card += amount
  else if (sale.paymentMode === 'UPI') refund.upi += amount
  else if (sale.paymentMode === 'CREDIT') refund.credit += amount
  refund.total += amount
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

    addRefundFromSale(refund, {
      paymentMode: sale.paymentMode,
      quantityBottles: sale.quantityBottles,
      totalAmount: sale.totalAmount,
      cashAmount: sale.cashAmount,
      cardAmount: sale.cardAmount,
      upiAmount: sale.upiAmount,
    }, sale.quantityBottles)

    // Insert a negative VOID row as audit trail instead of deleting the original
    await prisma.sale.create({
      data: {
        saleDate:        sale.saleDate,
        saleTime:        now,
        staffId:         staffId,
        productSizeId:   sale.productSizeId,
        quantityBottles: -sale.quantityBottles,
        sellingPrice:    sale.sellingPrice,
        totalAmount:     0,
        paymentMode:     'VOID',
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
        const lines = await tx.sale.findMany({
          where: {
            saleDate: today,
            productSizeId: item.productSizeId,
            quantityBottles: { gt: 0 },
          },
          orderBy: [{ saleTime: 'desc' }, { id: 'desc' }],
        })

        const available = lines.reduce((sum, line) => sum + line.quantityBottles, 0)
        if (item.quantityBottles > available) {
          throw new Error(`Only ${available} sold bottles available to void for product #${item.productSizeId}`)
        }

        let remaining = item.quantityBottles
        for (const line of lines) {
          if (remaining <= 0) break
          const voidQty = Math.min(remaining, line.quantityBottles)
          remaining -= voidQty

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
              totalAmount:     0,
              paymentMode:     'VOID',
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
