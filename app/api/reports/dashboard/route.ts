export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { subtractDays, toUtcNoonDate } from '@/lib/date-utils'

export async function GET() {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string } | undefined

  if (!session || user?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Owner dashboard is admin only' }, { status: 403 })
  }

  const today = toUtcNoonDate(new Date())

  // Per-clerk billing today
  const clerkBilling = await prisma.sale.groupBy({
    by: ['staffId'],
    where: { saleDate: today },
    _sum: { totalAmount: true, quantityBottles: true },
    _count: { id: true },
    orderBy: { _sum: { totalAmount: 'desc' } },
  })
  const allStaff = await prisma.staff.findMany({ select: { id: true, name: true } })
  const staffMap = Object.fromEntries(allStaff.map(s => [s.id, s.name]))
  const clerkBillingData = clerkBilling.map(row => ({
    staffId: row.staffId,
    name: staffMap[row.staffId] ?? `Staff #${row.staffId}`,
    bills: row._count.id,
    bottles: row._sum.quantityBottles ?? 0,
    amount: Number(row._sum.totalAmount ?? 0),
  }))

  // Today's sales
  const salesAgg = await prisma.sale.groupBy({
    by: ['paymentMode'],
    where: { saleDate: today },
    _sum: { totalAmount: true, quantityBottles: true },
  })

  const todaySales = {
    total: salesAgg.reduce((s, x) => s + Number(x._sum.totalAmount ?? 0), 0),
    bottles: salesAgg.reduce((s, x) => s + (x._sum.quantityBottles ?? 0), 0),
    cash: salesAgg.find(x => x.paymentMode === 'CASH')?._sum.totalAmount ?? 0,
    card: salesAgg.find(x => x.paymentMode === 'CARD')?._sum.totalAmount ?? 0,
    upi: salesAgg.find(x => x.paymentMode === 'UPI')?._sum.totalAmount ?? 0,
    credit: salesAgg.find(x => x.paymentMode === 'CREDIT')?._sum.totalAmount ?? 0,
  }

  // Active alerts
  const alerts = await prisma.varianceRecord.count({
    where: { resolved: false, severity: { not: 'OK' } },
  })
  const highAlerts = await prisma.varianceRecord.count({
    where: { resolved: false, severity: 'HIGH' },
  })

  // Pending indents
  const pendingIndents = await prisma.indent.count({ where: { status: 'PENDING' } })

  // Sales last 7 days
  const sevenDaysAgo = subtractDays(today, 6)

  const weeklySales = await prisma.sale.groupBy({
    by: ['saleDate'],
    where: { saleDate: { gte: sevenDaysAgo, lte: today } },
    _sum: { totalAmount: true, quantityBottles: true },
    orderBy: { saleDate: 'asc' },
  })

  // Top sellers today
  const topSellers = await prisma.sale.groupBy({
    by: ['productSizeId'],
    where: { saleDate: today },
    _sum: { quantityBottles: true, totalAmount: true },
    orderBy: { _sum: { totalAmount: 'desc' } },
    take: 5,
  })

  const topSellersDetail = await Promise.all(
    topSellers.map(async t => {
      const ps = await prisma.productSize.findUnique({
        where: { id: t.productSizeId },
        include: { product: true },
      })
      return {
        name: `${ps?.product.name} ${ps?.sizeMl}ml`,
        bottles: t._sum.quantityBottles ?? 0,
        amount: Number(t._sum.totalAmount ?? 0),
      }
    })
  )

  // Recent variance alerts
  const recentAlerts = await prisma.varianceRecord.findMany({
    where: { resolved: false, severity: { not: 'OK' } },
    include: { productSize: { include: { product: true } } },
    orderBy: [{ severity: 'desc' }, { recordDate: 'desc' }],
    take: 5,
  })

  return NextResponse.json({
    todaySales,
    alerts: { total: alerts, high: highAlerts },
    pendingIndents,
    clerkBilling: clerkBillingData,
    weeklySales: weeklySales.map(s => ({
      date: s.saleDate,
      amount: Number(s._sum.totalAmount ?? 0),
      bottles: s._sum.quantityBottles ?? 0,
    })),
    topSellers: topSellersDetail,
    recentAlerts: recentAlerts.map(a => ({
      id: a.id,
      product: a.productSize.product.name,
      sizeMl: a.productSize.sizeMl,
      variance: a.variance,
      severity: a.severity,
      date: a.recordDate,
    })),
  })
}
