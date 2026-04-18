/**
 * /api/pending-bills
 * GET  — list unsettled pending bills (today by default, or ?date=YYYY-MM-DD, or ?all=1)
 * POST — create a new pending bill from cart items
 * PATCH — settle a pending bill with a payment mode
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'
import { getAvailableStock } from '@/lib/stock-utils'

export const dynamic = 'force-dynamic'

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

  const body = await req.json() as {
    staffId: number
    customerName?: string
    items: Array<{ productSizeId: number; quantityBottles: number; sellingPrice: number }>
  }

  const { staffId, customerName, items } = body
  if (!staffId || !items?.length) {
    return NextResponse.json({ error: 'staffId and items required' }, { status: 400 })
  }

  // Check stock availability for each item
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
        return NextResponse.json({ error: `Only ${available} bottles available for ${productSize.size}` }, { status: 409 })
      }
    }
  }

  const today = toUtcNoonDate(new Date())

  // Generate a sequential bill reference for today
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const count = await prisma.pendingBill.count({
    where: { createdAt: { gte: todayStart } },
  })
  const billRef = `PB-${String(count + 1).padStart(3, '0')}`

  const totalAmount = items.reduce((s, i) => s + i.sellingPrice * i.quantityBottles, 0)

  const bill = await prisma.pendingBill.create({
    data: {
      billRef,
      saleDate: today,
      staffId,
      customerName: customerName || null,
      totalAmount,
      items: {
        create: items.map(i => ({
          productSizeId: i.productSizeId,
          quantityBottles: i.quantityBottles,
          sellingPrice: i.sellingPrice,
          totalAmount: i.sellingPrice * i.quantityBottles,
        })),
      },
    },
    include: {
      staff: { select: { id: true, name: true } },
      items: { include: { productSize: { include: { product: true } } } },
    },
  })

  return NextResponse.json(bill)
}

// PUT /api/pending-bills — append items to an existing unsettled tab
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    id: number
    items: Array<{ productSizeId: number; quantityBottles: number; sellingPrice: number }>
  }

  const { id, items } = body
  if (!id || !items?.length) return NextResponse.json({ error: 'id and items required' }, { status: 400 })

  const bill = await prisma.pendingBill.findUnique({ where: { id }, include: { items: true } })
  if (!bill) return NextResponse.json({ error: 'Tab not found' }, { status: 404 })
  if (bill.settled) return NextResponse.json({ error: 'Tab already settled' }, { status: 409 })

  const addedAmount = items.reduce((s, i) => s + i.sellingPrice * i.quantityBottles, 0)

  const updated = await prisma.$transaction(async tx => {
    await tx.pendingBillItem.createMany({
      data: items.map(i => ({
        billId: id,
        productSizeId: i.productSizeId,
        quantityBottles: i.quantityBottles,
        sellingPrice: i.sellingPrice,
        totalAmount: i.sellingPrice * i.quantityBottles,
      })),
    })
    return tx.pendingBill.update({
      where: { id },
      data: { totalAmount: { increment: addedAmount } },
      include: {
        staff: { select: { id: true, name: true } },
        items: { include: { productSize: { include: { product: true } } } },
      },
    })
  })

  return NextResponse.json(updated)
}

// PATCH /api/pending-bills — settle a pending bill
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    id: number
    paymentMode: 'CASH' | 'CARD' | 'UPI' | 'SPLIT'
    cashAmount?: number
    cardAmount?: number
    upiAmount?: number
    settledById: number
  }

  const { id, paymentMode, cashAmount, cardAmount, upiAmount, settledById } = body
  if (!id || !paymentMode) return NextResponse.json({ error: 'id and paymentMode required' }, { status: 400 })

  const bill = await prisma.pendingBill.findUnique({
    where: { id },
    include: { items: true },
  })
  if (!bill) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
  if (bill.settled) return NextResponse.json({ error: 'Bill already settled' }, { status: 409 })

  const now = new Date()
  const saleDate = toUtcNoonDate(now)
  const billTimeIso = now.toISOString()

  // Create real Sale rows for each item in the pending bill
  const userId = (session.user as { id?: string } | undefined)?.id
  const effectiveSettledById = settledById ?? (userId ? parseInt(userId) : bill.staffId)

  await prisma.$transaction(async tx => {
    // Create sale rows
    for (const item of bill.items) {
      const prop = Number(item.totalAmount) / Number(bill.totalAmount)
      await tx.sale.create({
        data: {
          saleDate,
          saleTime: new Date(billTimeIso),
          staffId: bill.staffId,
          productSizeId: item.productSizeId,
          quantityBottles: item.quantityBottles,
          sellingPrice: item.sellingPrice,
          totalAmount: item.totalAmount,
          paymentMode: paymentMode as never,
          cashAmount: paymentMode === 'SPLIT' && cashAmount != null ? cashAmount * prop : null,
          cardAmount: paymentMode === 'SPLIT' && cardAmount != null ? cardAmount * prop : null,
          upiAmount: paymentMode === 'SPLIT' && upiAmount != null ? upiAmount * prop : null,
          scanMethod: 'MANUAL',
          customerName: bill.customerName,
          overrideReason: `pending:${bill.billRef}`,
          billId: `pending-${bill.id}`,
        },
      })
    }

    // Mark bill as settled
    await tx.pendingBill.update({
      where: { id },
      data: {
        settled: true,
        settledAt: now,
        settledMode: paymentMode as never,
        settledById: effectiveSettledById,
      },
    })
  })

  return NextResponse.json({ success: true, billRef: bill.billRef })
}
