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
import { ensureDailyRollover } from '@/lib/rollover'

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

  const today = toUtcNoonDate(new Date())

  try {
    // ── Stock checks BEFORE transaction (avoids timeout on slow Neon connections) ──
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

    // Generate bill ref before transaction
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const count = await prisma.pendingBill.count({ where: { createdAt: { gte: todayStart } } })
    const billRef = `PB-${String(count + 1).padStart(3, '0')}`
    const totalAmount = items.reduce((s, i) => s + i.sellingPrice * i.quantityBottles, 0)

    // ── Minimal transaction: only writes ──────────────────────────────────────
    const bill = await prisma.$transaction(async tx => {
      return tx.pendingBill.create({
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
        select: { id: true },
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

    return NextResponse.json(fullBill)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create pending bill'
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

  const bill = await prisma.pendingBill.findUnique({ where: { id }, include: { items: true } })
  if (!bill) return NextResponse.json({ error: 'Tab not found' }, { status: 404 })
  if (bill.settled) return NextResponse.json({ error: 'Tab already settled' }, { status: 409 })

  const addedAmount = items.reduce((s, i) => s + i.sellingPrice * i.quantityBottles, 0)

  // Keep transaction minimal — only writes, no deep reads
  await prisma.$transaction(async tx => {
    await tx.pendingBillItem.createMany({
      data: items.map(i => ({
        billId: id,
        productSizeId: i.productSizeId,
        quantityBottles: i.quantityBottles,
        sellingPrice: i.sellingPrice,
        totalAmount: i.sellingPrice * i.quantityBottles,
      })),
    })
    await tx.pendingBill.update({
      where: { id },
      data: { totalAmount: { increment: addedAmount } },
    })
  })

  // Fetch full result outside transaction
  const updated = await prisma.pendingBill.findUnique({
    where: { id },
    include: {
      staff: { select: { id: true, name: true } },
      items: { include: { productSize: { include: { product: true } } } },
    },
  })

  return NextResponse.json(updated)
}

// PATCH /api/pending-bills — settle a pending bill or void items
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureDailyRollover()

  const body = await req.json() as {
    id: number
    paymentMode?: 'CASH' | 'CARD' | 'UPI' | 'SPLIT'
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

  // Handle voiding items
  // Note: stock is implicitly restored because getAvailableStock subtracts
  // unsettled pending bill items — removing the items releases the reservation.
  if (voidItemIds && voidItemIds.length > 0) {
    const itemsToVoid = bill.items.filter(item => voidItemIds.includes(item.id))
    if (itemsToVoid.length === 0) return NextResponse.json({ error: 'No valid items to void' }, { status: 400 })

    const voidAmount = itemsToVoid.reduce((sum, item) => sum + Number(item.totalAmount), 0)
    const voidedBottles = itemsToVoid.reduce((sum, item) => sum + item.quantityBottles, 0)

    const result = await prisma.$transaction(async tx => {
      // Create audit trail via stock adjustments before deleting
      const userId = (session.user as { id?: string } | undefined)?.id
      const createdById = userId ? parseInt(userId) : bill.staffId
      for (const item of itemsToVoid) {
        await tx.stockAdjustment.create({
          data: {
            adjustmentDate: toUtcNoonDate(new Date()),
            productSizeId: item.productSizeId,
            adjustmentType: 'RETURN',
            quantityBottles: 0, // net zero — stock was reserved, now unreserved
            reason: `Voided from pending bill ${bill.billRef}: ${item.quantityBottles} bottle(s)`,
            createdById,
            approved: true,
            approvedById: createdById,
          },
        })
      }

      await tx.pendingBillItem.deleteMany({
        where: { id: { in: voidItemIds }, billId: id },
      })
      await tx.pendingBill.update({
        where: { id },
        data: { totalAmount: { decrement: voidAmount } },
      })

      // Check remaining items inside the transaction
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
    return NextResponse.json(updatedBill)
  }

  // Handle settlement
  if (!paymentMode) return NextResponse.json({ error: 'paymentMode required for settlement' }, { status: 400 })

  const now = new Date()
  const saleDate = toUtcNoonDate(now)
  const billTimeIso = now.toISOString()

  // Create real Sale rows for each item in the pending bill
  const userId = (session.user as { id?: string } | undefined)?.id
  const effectiveSettledById = settledById ?? (userId ? parseInt(userId) : bill.staffId)

  const saleTime = new Date(billTimeIso)
  await prisma.$transaction([
    // Bulk-create all sale rows in one statement
    prisma.sale.createMany({
      data: bill.items.map(item => {
        const prop = Number(item.totalAmount) / Number(bill.totalAmount)
        return {
          saleDate,
          saleTime,
          staffId: bill.staffId,
          productSizeId: item.productSizeId,
          quantityBottles: item.quantityBottles,
          sellingPrice: item.sellingPrice,
          totalAmount: item.totalAmount,
          paymentMode: paymentMode as never,
          cashAmount: paymentMode === 'SPLIT' && cashAmount != null ? cashAmount * prop : null,
          cardAmount: paymentMode === 'SPLIT' && cardAmount != null ? cardAmount * prop : null,
          upiAmount: paymentMode === 'SPLIT' && upiAmount != null ? upiAmount * prop : null,
          scanMethod: 'MANUAL' as never,
          customerName: bill.customerName,
          overrideReason: `pending:${bill.billRef}`,
          billId: `pending-${bill.id}`,
        }
      }),
    }),
    prisma.pendingBill.update({
      where: { id },
      data: { settled: true, settledAt: now, settledMode: paymentMode as never, settledById: effectiveSettledById },
    }),
  ])

  return NextResponse.json({ success: true, billRef: bill.billRef })
}
