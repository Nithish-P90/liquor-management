import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const dateStr = searchParams.get('date')
  const today = dateStr
    ? toUtcNoonDate(new Date(dateStr + 'T12:00:00'))
    : toUtcNoonDate(new Date())
  const dayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0))
  const nextDayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1, 0, 0, 0, 0))

  const [sales, miscAgg] = await Promise.all([
    prisma.sale.findMany({
      where: { saleDate: today },
      select: {
        id: true,
        saleTime: true,
        staffId: true,
        quantityBottles: true,
        totalAmount: true,
        staff: { select: { id: true, name: true, role: true } },
      },
      orderBy: [{ saleTime: 'desc' }, { id: 'desc' }],
    }),
    prisma.miscSale.aggregate({
      where: { saleDate: { gte: dayStart, lt: nextDayStart } },
      _sum: { totalAmount: true, quantity: true },
      _count: { _all: true },
    }),
  ])

  const map = new Map<string, {
    staffId: number
    name: string
    billKeys: Set<string>
    bottles: number
    amount: number
  }>()

  for (const sale of sales) {
    const isCounter = sale.staff.role === 'CASHIER'
    const key = isCounter ? 'COUNTER' : `STAFF:${sale.staffId}`
    const name = isCounter ? 'Counter' : sale.staff.name
    const isRefund = sale.paymentMode === 'VOID' || sale.quantityBottles < 0

    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        staffId: isCounter ? 0 : sale.staffId,
        name,
        billKeys: new Set(isRefund ? [] : [`${sale.staffId}:${sale.saleTime.toISOString()}`]),
        bottles: isRefund ? 0 : sale.quantityBottles,
        amount: Number(sale.totalAmount),
      })
      continue
    }

    if (!isRefund) {
      existing.billKeys.add(`${sale.staffId}:${sale.saleTime.toISOString()}`)
      existing.bottles += sale.quantityBottles
    }
    existing.amount += Number(sale.totalAmount)
  }

  const rows = Array.from(map.values())
    .map(row => ({
      staffId: row.staffId,
      name: row.name,
      bills: row.billKeys.size,
      bottles: row.bottles,
      amount: row.amount,
    }))
    .sort((a, b) => b.amount - a.amount)

  const liquorRevenue = rows.reduce((sum, row) => sum + row.amount, 0)
  const liquorBills = rows.reduce((sum, row) => sum + row.bills, 0)
  const liquorBottles = rows.reduce((sum, row) => sum + row.bottles, 0)
  const miscRevenue = Number(miscAgg._sum.totalAmount ?? 0)
  const miscItems = Number(miscAgg._sum.quantity ?? 0)
  const miscEntries = miscAgg._count._all

  return NextResponse.json({
    rows,
    summary: {
      liquorRevenue,
      liquorBills,
      liquorBottles,
      miscRevenue,
      miscItems,
      miscEntries,
      totalRevenue: liquorRevenue,
    },
  })
}
