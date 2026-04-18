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

  const [sales, miscByStaff] = await Promise.all([
    prisma.sale.findMany({
      where: { saleDate: today },
      select: {
        id: true,
        saleTime: true,
        staffId: true,
        paymentMode: true,
        quantityBottles: true,
        totalAmount: true,
        staff: { select: { id: true, name: true, role: true } },
      },
      orderBy: [{ saleTime: 'desc' }, { id: 'desc' }],
    }),
    prisma.miscSale.groupBy({
      by: ['staffId'],
      where: { saleDate: { gte: dayStart, lt: nextDayStart } },
      _sum: { totalAmount: true, quantity: true },
      _count: { _all: true },
    }),
  ])

  const miscStaffIds = miscByStaff.map(row => row.staffId)
  const miscStaffRows = miscStaffIds.length > 0
    ? await prisma.staff.findMany({ where: { id: { in: miscStaffIds } }, select: { id: true, name: true, role: true } })
    : []
  const miscStaffMap = new Map(miscStaffRows.map(s => [s.id, s]))

  const map = new Map<string, {
    staffId: number
    name: string
    billKeys: Set<string>
    bottles: number
    amount: number
    miscPieces: number
  }>()

  function ensureRow(key: string, staffId: number, name: string) {
    const existing = map.get(key)
    if (existing) return existing
    const created = {
      staffId,
      name,
      billKeys: new Set<string>(),
      bottles: 0,
      amount: 0,
      miscPieces: 0,
    }
    map.set(key, created)
    return created
  }

  for (const sale of sales) {
    const isCounter = sale.staff.role === 'CASHIER'
    const key = isCounter ? 'COUNTER' : `STAFF:${sale.staffId}`
    const name = isCounter ? 'Counter' : sale.staff.name
    const isRefund = sale.paymentMode === 'VOID' || sale.quantityBottles < 0

    const existing = ensureRow(key, isCounter ? 0 : sale.staffId, name)

    if (!isRefund) {
      existing.billKeys.add(`${sale.staffId}:${sale.saleTime.toISOString()}`)
    }
    // Net bottles: returns/void rows carry negative quantityBottles and must reduce sold bottles.
    existing.bottles += sale.quantityBottles
    existing.amount += Number(sale.totalAmount)
  }

  for (const row of miscByStaff) {
    const staff = miscStaffMap.get(row.staffId)
    const isCounter = staff?.role === 'CASHIER'
    const key = isCounter ? 'COUNTER' : `STAFF:${row.staffId}`
    const name = isCounter ? 'Counter' : (staff?.name ?? `Staff ${row.staffId}`)
    const existing = ensureRow(key, isCounter ? 0 : row.staffId, name)
    existing.miscPieces += Number(row._sum.quantity ?? 0)
  }

  const rows = Array.from(map.values())
    .map(row => ({
      staffId: row.staffId,
      name: row.name,
      bills: row.billKeys.size,
      bottles: row.bottles,
      amount: row.amount,
      miscPieces: row.miscPieces,
    }))
    .sort((a, b) => b.amount - a.amount)

  const liquorRevenue = rows.reduce((sum, row) => sum + row.amount, 0)
  const liquorBills = rows.reduce((sum, row) => sum + row.bills, 0)
  const liquorBottles = rows.reduce((sum, row) => sum + row.bottles, 0)
  const miscRevenue = miscByStaff.reduce((sum, row) => sum + Number(row._sum.totalAmount ?? 0), 0)
  const miscItems = miscByStaff.reduce((sum, row) => sum + Number(row._sum.quantity ?? 0), 0)
  const miscEntries = miscByStaff.reduce((sum, row) => sum + row._count._all, 0)

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
