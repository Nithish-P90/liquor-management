import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { toUtcNoonDate } from '@/lib/date-utils'

function isAllowedRole(role?: string) {
  return role === 'ADMIN' || role === 'CASHIER' || role === 'STAFF'
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string } | undefined
  if (!session || !isAllowedRole(user?.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dateParam = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10)
  const day = toUtcNoonDate(new Date(dateParam + 'T12:00:00Z'))
  const dayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0, 0))
  const nextDayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1, 0, 0, 0, 0))
  const sales = await prisma.miscSale.findMany({
    where: {
      saleDate: {
        gte: dayStart,
        lt: nextDayStart,
      },
    },
    include: { item: true },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(sales)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { id?: string; role?: string } | undefined
  if (!session || !isAllowedRole(user?.role)) {
    return NextResponse.json({ error: 'Only admins and cashiers can record misc sales' }, { status: 403 })
  }

  const body = await req.json()
  if (!Array.isArray(body?.items) || !body?.saleDate) {
    return NextResponse.json({ error: 'saleDate and items[] are required' }, { status: 400 })
  }

  let staffId = Number(body?.staffId ?? user?.id ?? 0)
  if (!Number.isInteger(staffId) || staffId <= 0) {
    const fallbackStaff = await prisma.staff.findFirst({
      where: { active: true, role: { in: ['ADMIN', 'CASHIER'] } },
      orderBy: { id: 'asc' },
      select: { id: true },
    })
    if (!fallbackStaff) {
      return NextResponse.json({ error: 'No active cashier/admin found for misc sale attribution' }, { status: 400 })
    }
    staffId = fallbackStaff.id
  }

  const items = body.items as Array<{ itemId: number; quantity: number; unitPrice: number; totalAmount: number }>
  if (items.length === 0) {
    return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })
  }
  const hasInvalid = items.some(item => {
    return !Number.isInteger(Number(item.itemId)) || Number(item.itemId) <= 0 ||
      !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 ||
      !Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) <= 0 ||
      !Number.isFinite(Number(item.totalAmount)) || Number(item.totalAmount) <= 0
  })
  if (hasInvalid) {
    return NextResponse.json({ error: 'Invalid item payload' }, { status: 400 })
  }

  const saleDate = toUtcNoonDate(new Date(body.saleDate + 'T12:00:00Z'))
  const now = new Date()
  const created = await prisma.$transaction(
    items.map(item =>
      prisma.miscSale.create({
        data: {
          staffId,
          itemId: Number(item.itemId),
          saleDate,
          saleTime: now,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          totalAmount: Number(item.totalAmount),
          // Misc sales are tracked in a separate ledger and are not split by payment method.
          paymentMode: 'CASH',
        },
      })
    )
  )
  return NextResponse.json({ count: created.length })
}
