import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

function isAllowedRole(role?: string) {
  return role === 'ADMIN' || role === 'CASHIER'
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string } | undefined
  if (!session || !isAllowedRole(user?.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dateParam = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10)
  const saleDate = new Date(dateParam + 'T00:00:00Z')
  const sales = await prisma.miscSale.findMany({
    where: { saleDate },
    include: { item: true },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(sales)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string } | undefined
  if (!session || !isAllowedRole(user?.role)) {
    return NextResponse.json({ error: 'Only admins and cashiers can record misc sales' }, { status: 403 })
  }

  const body = await req.json()
  if (!Array.isArray(body?.items) || !body?.saleDate) {
    return NextResponse.json({ error: 'saleDate and items[] are required' }, { status: 400 })
  }

  const saleDate = new Date(body.saleDate + 'T00:00:00Z')
  const now = new Date()
  const created = await prisma.$transaction(
    body.items.map((item: { itemId: number; quantity: number; unitPrice: number; totalAmount: number }) =>
      prisma.miscSale.create({
        data: {
          itemId: item.itemId,
          saleDate,
          saleTime: now,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalAmount: item.totalAmount,
          // Misc sales are tracked in a separate ledger and are not split by payment method.
          paymentMode: 'CASH',
        },
      })
    )
  )
  return NextResponse.json({ count: created.length })
}
