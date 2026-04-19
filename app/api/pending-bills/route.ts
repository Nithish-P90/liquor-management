/**
 * /api/pending-bills
 * GET  — list unsettled pending bills (today by default, or ?date=YYYY-MM-DD, or ?all=1)
 * POST — create a new pending bill from cart items
 * PUT  — append items to an existing unsettled tab
 * PATCH — settle a pending bill with a payment mode, or void items
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'
import { getAvailableStock } from '@/lib/stock-utils'
import { ensureDailyRollover } from '@/lib/rollover'

export const dynamic = 'force-dynamic'

const VALID_PAYMENT_MODES = ['CASH', 'CARD', 'UPI', 'SPLIT']

/** Validate each item in the request body */
function validateItems(items: Array<{ productSizeId: number; quantityBottles: number; sellingPrice: number }>): string | null {
  for (const item of items) {
    if (!Number.isInteger(item.productSizeId) || item.productSizeId <= 0) {
      return 'Invalid productSizeId'
    }
    if (!Number.isInteger(item.quantityBottles) || item.quantityBottles <= 0) {
      return 'quantityBottles must be a positive integer'
    }
    if (typeof item.sellingPrice !== 'number' || !Number.isFinite(item.sellingPrice) || item.sellingPrice < 0) {
      return 'sellingPrice must be a non-negative number'
    }
  }
  return null
}

/** Round to 2 decimal places */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// GET /api/pending-bills?all=1 or ?date=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const all = searchParams.get('all') === '1'
  const dateStr = searchParams.get('date')

  const where: Record<string, unknown> = { settled: false }
  if (!all) {
    const date = dateStr
      ? toUtcNoonDate(new Date(dateStr + 'T12:00:00'))
      : toUtcNoonDate(new Date())
    where.saleDate = date
  }

  const bills = await prisma.pendingBill.findMany({
    where,
    include: {
      staff: { select: { id: true, name: true, role: true } },
      items: {
        include: {
          productSize: { include: { product: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(bills)
}

// POST /api/pending-bills — create pending bill
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureDailyRollover()

  const body = await req.json() as {
    staffId: number
    customerName?: string
    items: Array<{ productSizeId: number; quantityBottles: number; sellingPrice: number }>
  }

  const { staffId, customerName, items } = body
  if (!staffId || !items?.length) {
    return NextResponse.json({ error: 'staffId and items required' }, { status: 400 })
  }

  // Validate items
  const itemError = validateItems(items)
  if (itemError) return NextResponse.json({ error: itemError }, { status: 400 })

  // Validate staff exists
  const staffExists = await prisma.staff.findUnique({ where: { id: staffId }, select: { id: true } })
  if (!staffExists) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })

  const today = toUtcNoonDate(new Date())

  try {
    // Stock checks before transaction (avoids timeout on slow Neon connections)
    for (const item of items) {
      const productSize = await prisma.productSize.findUnique({
        where: { id: item.productSizeId },
        include: { product: { select: { category: true } } },
      })
      if (!productSize) {
        return NextResponse.json({ error: `Product size ${item.productSizeId} not found` }, { status: 404 })
      }
      if (productSize.product.category !== 'MISCELLANEOUS') {
        const available = await getAvailableStock(prisma, item.productSizeId)
        if (item.quantityBottles > available) {
          return NextResponse.json({ error: `Only ${available} bottles available for ${productSize.sizeMl}ml` }, { status: 409 })
        }
      }
    }

    const totalAmount = round2(items.reduce((s, i) => s + i.sellingPrice * i.quantityBottles, 0))

    // billRef + write inside transaction to prevent duplicate refs
    const bill = await prisma.$transaction(async tx => {
      // Count inside tx to avoid race condition on billRef
      const todayUtc = toUtcNoonDate(new Date())
      const count = await tx.pendingBill.count({ where: { saleDate: todayUtc } })
      const billRef = `PB-${String(count + 1).padStart(3, '0')}`

      return tx.pendingBill.create({
        data: {
          billRef,
          saleDate: today,
          staffId,
          customerName: customerName?.trim() || null,
          totalAmount,
          items: {
            create: items.map(i => ({
              productSizeId: i.productSizeId,
              quantityBottles: i.quantityBottles,
              sellingPrice: i.sellingPrice,
              totalAmount: round2(i.sellingPrice * i.quantityBottles),
            })),
          },
        },
        select: { id: true, billRef: true },
      })
    })

    // Fetch full record outside transaction (no timeout risk)
    const fullBill = await prisma.pendingBill.findUnique({
      where: { id: bill.id },
      include: {
        staff: { select: { id: true, name: true } },
        items: { include: { productSize: { include: { product: true } } } },
      },
    })

    if (!fullBill) {
      return NextResponse.json({ error: 'Bill created but could not be fetched' }, { status: 500 })
    }

    return NextResponse.json(fullBill, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create pending bill'
    console.error('[pending-bills POST]', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// PUT /api/pending-bills — append items to an existing unsettled tab
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureDailyRollover()

  const body = await req.json() as {
    id: number
    items: Array<{ productSizeId: number; quantityBottles: number; sellingPrice: number }>
  }

  const { id, items } = body
  if (!id || !items?.length) return NextResponse.json({ error: 'id and items required' }, { status: 400 })

  // Validate items
  const itemError = validateItems(items)
  if (itemError) return NextResponse.json({ error: itemError }, { status: 400 })

  // Stock checks (was missing entirely before)
  for (const item of items) {
    const productSize = await prisma.productSize.findUnique({
      where: { id: item.productSizeId },
      include: { product: { select: { category: true } } },
    })
    if (!productSize) {
      return NextResponse.json({ error: `Product size ${item.productSizeId} not found` }, { status: 404 })
    }
    if (productSize.product.category !== 'MISCELLANEOUS') {
      const available = await getAvailableStock(prisma, item.productSizeId)
      if (item.quantityBottles > available) {
        return NextResponse.json({ error: `Only ${available} bottles available for ${productSize.sizeMl}ml` }, { status: 409 })
      }
    }
  }

  const addedAmount = round2(items.reduce((s, i) => s + i.sellingPrice * i.quantityBottles, 0))

  // Write + settled guard inside transaction to prevent race
  try {
    await prisma.$transaction(async tx => {
      // Re-check settled inside transaction to prevent race condition
      const current = await tx.pendingBill.findUnique({ where: { id }, select: { settled: true } })
      if (!current) throw new Error('Tab not found')
      if (current.settled) throw new Error('Tab already settled')

      await tx.pendingBillItem.createMany({
        data: items.map(i => ({
          billId: id,
          productSizeId: i.productSizeId,
          quantityBottles: i.quantityBottles,
          sellingPrice: i.sellingPrice,
          totalAmount: round2(i.sellingPrice * i.quantityBottles),
        })),
      })
      await tx.pendingBill.update({
        where: { id },
        data: { totalAmount: { increment: addedAmount } },
      })
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to add items'
    const status = msg.includes('not found') ? 404 : msg.includes('settled') ? 409 : 500
    return NextResponse.json({ error: msg }, { status })
  }

  // Fetch full result outside transaction
  const updated = await prisma.pendingBill.findUnique({
    where: { id },
    include: {
      staff: { select: { id: true, name: true } },
      items: { include: { productSize: { include: { product: true } } } },
    },
  })

  if (!updated) return NextResponse.json({ error: 'Tab not found after update' }, { status: 404 })
  return NextResponse.json(updated)
}

// PATCH /api/pending-bills — settle a pending bill or void items
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureDailyRollover()

  const body = await req.json() as {
    id: number
    paymentMode?: string
    cashAmount?: number
    cardAmount?: number
    upiAmount?: number
    settledById?: number
    voidItemIds?: number[]
  }

  const { id, paymentMode, cashAmount, cardAmount, upiAmount, settledById, voidItemIds } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const bill = await prisma.pendingBill.findUnique({
    where: { id },
    include: { items: true },
  })
  if (!bill) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
  if (bill.settled) return NextResponse.json({ error: 'Bill already settled' }, { status: 409 })

  // ── Handle voiding items ────────────────────────────────────────────────────
  if (voidItemIds && voidItemIds.length > 0) {
    const itemsToVoid = bill.items.filter(item => voidItemIds.includes(item.id))
    if (itemsToVoid.length === 0) return NextResponse.json({ error: 'No valid items to void' }, { status: 400 })

    const voidAmount = itemsToVoid.reduce((sum, item) => sum + Number(item.totalAmount), 0)
    const voidedBottles = itemsToVoid.reduce((sum, item) => sum + item.quantityBottles, 0)

    const result = await prisma.$transaction(async tx => {
      // Delete the items (stock is implicitly returned since getAvailableStock
      // subtracts unsettled pending items — removing them releases the reservation)
      await tx.pendingBillItem.deleteMany({
        where: { id: { in: voidItemIds }, billId: id },
      })
      await tx.pendingBill.update({
        where: { id },
        data: { totalAmount: { decrement: voidAmount } },
      })

      const remainingItems = await tx.pendingBillItem.count({ where: { billId: id } })
      if (remainingItems === 0) {
        await tx.pendingBill.delete({ where: { id } })
        return { deleted: true }
      }

      return { deleted: false }
    })

    if (result.deleted) {
      return NextResponse.json({ success: true, deleted: true, voidedBottles })
    }

    const updatedBill = await prisma.pendingBill.findUnique({
      where: { id },
      include: {
        staff: { select: { id: true, name: true } },
        items: { include: { productSize: { include: { product: true } } } },
      },
    })
    return NextResponse.json({ success: true, voidedBottles, bill: updatedBill })
  }

  // ── Handle settlement ──────────────────────────────────────────────────────
  if (!paymentMode) return NextResponse.json({ error: 'paymentMode required for settlement' }, { status: 400 })
  if (!VALID_PAYMENT_MODES.includes(paymentMode)) {
    return NextResponse.json({ error: `Invalid paymentMode. Must be one of: ${VALID_PAYMENT_MODES.join(', ')}` }, { status: 400 })
  }

  const billTotal = Number(bill.totalAmount)
  if (billTotal <= 0) {
    return NextResponse.json({ error: 'Cannot settle a bill with zero or negative total' }, { status: 400 })
  }

  const now = new Date()
  const saleDate = toUtcNoonDate(now)

  const userId = (session.user as { id?: string } | undefined)?.id
  const effectiveSettledById = settledById ?? (userId ? parseInt(userId) : bill.staffId)

  // Build sale data with correct split allocation (last item gets remainder to avoid rounding drift)
  const saleData = bill.items.map((item, idx) => {
    const isLast = idx === bill.items.length - 1

    let itemCash: number | null = null
    let itemCard: number | null = null
    let itemUpi: number | null = null

    if (paymentMode === 'SPLIT') {
      if (isLast) {
        // Last item gets remainder to prevent rounding drift
        const prevCash = bill.items.slice(0, -1).reduce((s, it) => {
          const p = Number(it.totalAmount) / billTotal
          return s + round2((cashAmount ?? 0) * p)
        }, 0)
        const prevCard = bill.items.slice(0, -1).reduce((s, it) => {
          const p = Number(it.totalAmount) / billTotal
          return s + round2((cardAmount ?? 0) * p)
        }, 0)
        const prevUpi = bill.items.slice(0, -1).reduce((s, it) => {
          const p = Number(it.totalAmount) / billTotal
          return s + round2((upiAmount ?? 0) * p)
        }, 0)
        itemCash = cashAmount != null ? round2((cashAmount ?? 0) - prevCash) : null
        itemCard = cardAmount != null ? round2((cardAmount ?? 0) - prevCard) : null
        itemUpi = upiAmount != null ? round2((upiAmount ?? 0) - prevUpi) : null
      } else {
        const prop = Number(item.totalAmount) / billTotal
        itemCash = cashAmount != null ? round2(cashAmount * prop) : null
        itemCard = cardAmount != null ? round2(cardAmount * prop) : null
        itemUpi = upiAmount != null ? round2(upiAmount * prop) : null
      }
    }

    return {
      saleDate,
      saleTime: now,
      staffId: bill.staffId,
      productSizeId: item.productSizeId,
      quantityBottles: item.quantityBottles,
      sellingPrice: item.sellingPrice,
      totalAmount: item.totalAmount,
      paymentMode: paymentMode as never,
      cashAmount: itemCash,
      cardAmount: itemCard,
      upiAmount: itemUpi,
      scanMethod: 'MANUAL' as never,
      customerName: bill.customerName,
      overrideReason: `pending:${bill.billRef}`,
      billId: `pending-${bill.id}`,
    }
  })

  await prisma.$transaction([
    prisma.sale.createMany({ data: saleData }),
    prisma.pendingBill.update({
      where: { id },
      data: { settled: true, settledAt: now, settledMode: paymentMode as never, settledById: effectiveSettledById },
    }),
  ])

  return NextResponse.json({ success: true, billRef: bill.billRef })
}
