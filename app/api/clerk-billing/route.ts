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

  const byClerk = await prisma.sale.groupBy({
    by: ['staffId'],
    where: { saleDate: today },
    _sum: { totalAmount: true, quantityBottles: true },
    _count: { id: true },
    orderBy: { _sum: { totalAmount: 'desc' } },
  })

  const staff = await prisma.staff.findMany({ select: { id: true, name: true } })
  const staffMap = Object.fromEntries(staff.map(s => [s.id, s.name]))

  return NextResponse.json(
    byClerk.map(row => ({
      staffId: row.staffId,
      name: staffMap[row.staffId] ?? `Staff #${row.staffId}`,
      bills: row._count.id,
      bottles: row._sum.quantityBottles ?? 0,
      amount: Number(row._sum.totalAmount ?? 0),
    }))
  )
}
