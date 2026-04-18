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

  const todayRows = await prisma.sale.findMany({
    where: { saleDate: today, quantityBottles: { gt: 0 }, paymentMode: { notIn: ['VOID', 'CREDIT'] } },
    select: {
      id: true,
      saleTime: true,
      staffId: true,
      paymentMode: true,
      totalAmount: true,
      quantityBottles: true,
      cashAmount: true,
      cardAmount: true,
      upiAmount: true,
      staff: { select: { name: true, role: true } },
    },
    orderBy: [{ saleTime: 'desc' }, { id: 'desc' }],
  })

  // Per-clerk billing today (cashiers merged as Counter)
  const clerkMap = new Map<string, {
    staffId: number
    name: string
    billKeys: Set<string>
    bottles: number
    amount: number
  }>()

  // Today's sales with split allocation into cash/card/upi
  const todaySales = {
    total: 0,
    bottles: 0,
    cash: 0,
    card: 0,
    upi: 0,
  }

  for (const sale of todayRows) {
    const saleAmount = Number(sale.totalAmount)
    todaySales.total += saleAmount
    todaySales.bottles += sale.quantityBottles

    if (sale.paymentMode === 'SPLIT') {
      todaySales.cash += Number(sale.cashAmount ?? 0)
      todaySales.card += Number(sale.cardAmount ?? 0)
      todaySales.upi += Number(sale.upiAmount ?? 0)
    } else if (sale.paymentMode === 'CASH') {
      todaySales.cash += saleAmount
    } else if (sale.paymentMode === 'CARD') {
      todaySales.card += saleAmount
    } else if (sale.paymentMode === 'UPI') {
      todaySales.upi += saleAmount
    }

    const isCounter = sale.staff.role === 'CASHIER'
    const key = isCounter ? 'COUNTER' : `STAFF:${sale.staffId}`
    const label = isCounter ? 'Counter' : sale.staff.name
    const existing = clerkMap.get(key)
    if (!existing) {
      clerkMap.set(key, {
        staffId: isCounter ? 0 : sale.staffId,
        name: label,
        billKeys: new Set([`${sale.staffId}:${sale.saleTime.toISOString()}`]),
        bottles: sale.quantityBottles,
        amount: saleAmount,
      })
      continue
    }
    existing.billKeys.add(`${sale.staffId}:${sale.saleTime.toISOString()}`)
    existing.bottles += sale.quantityBottles
    existing.amount += saleAmount
  }

  const clerkBillingData = Array.from(clerkMap.values())
    .map(row => ({
      staffId: row.staffId,
      name: row.name,
      bills: row.billKeys.size,
      bottles: row.bottles,
      amount: row.amount,
    }))
    .sort((a, b) => b.amount - a.amount)

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

  const thirtyDaysAgo = subtractDays(today, 29)

  async function resolveTopSellers(rows: { productSizeId: number; _sum: { quantityBottles: number | null; totalAmount: any }; _count: { id: number } }[]) {
    const ids = rows.map(r => r.productSizeId)
    const sizes = await prisma.productSize.findMany({
      where: { id: { in: ids } },
      include: { product: true },
    })
    const sizeMap = Object.fromEntries(sizes.map(s => [s.id, s]))
    return rows.map(t => {
      const ps = sizeMap[t.productSizeId]
      return {
        name: ps?.product.name ?? 'Unknown',
        sizeMl: ps?.sizeMl ?? 0,
        bottles: t._sum.quantityBottles ?? 0,
        amount: Number(t._sum.totalAmount ?? 0),
        txCount: t._count.id,
      }
    })
  }

  // Top sellers today
  const topSellersToday = await prisma.sale.groupBy({
    by: ['productSizeId'],
    where: { saleDate: today, quantityBottles: { gt: 0 } },
    _sum: { quantityBottles: true, totalAmount: true },
    _count: { id: true },
    orderBy: { _sum: { quantityBottles: 'desc' } },
    take: 8,
  })
  const topSellersDetail = await resolveTopSellers(topSellersToday)

  // Top sellers past 7 days
  const topSellersWeekRaw = await prisma.sale.groupBy({
    by: ['productSizeId'],
    where: { saleDate: { gte: sevenDaysAgo, lte: today }, quantityBottles: { gt: 0 } },
    _sum: { quantityBottles: true, totalAmount: true },
    _count: { id: true },
    orderBy: { _sum: { quantityBottles: 'desc' } },
    take: 8,
  })
  const topSellersWeek = await resolveTopSellers(topSellersWeekRaw)

  // Top sellers past 30 days
  const topSellersMonthRaw = await prisma.sale.groupBy({
    by: ['productSizeId'],
    where: { saleDate: { gte: thirtyDaysAgo, lte: today }, quantityBottles: { gt: 0 } },
    _sum: { quantityBottles: true, totalAmount: true },
    _count: { id: true },
    orderBy: { _sum: { quantityBottles: 'desc' } },
    take: 8,
  })
  const topSellersMonth = await resolveTopSellers(topSellersMonthRaw)

  // Recent variance alerts
  const recentAlerts = await prisma.varianceRecord.findMany({
    where: { resolved: false, severity: { not: 'OK' } },
    include: { productSize: { include: { product: true } } },
    orderBy: [{ severity: 'desc' }, { recordDate: 'desc' }],
    take: 5,
  })

  const miscAgg = await prisma.miscSale.aggregate({
    where: { saleDate: today },
    _sum: { totalAmount: true },
  })
  const miscSaleTotal = Number(miscAgg._sum.totalAmount ?? 0)

  return NextResponse.json({
    todaySales,
    miscSaleTotal,
    alerts: { total: alerts, high: highAlerts },
    pendingIndents,
    clerkBilling: clerkBillingData,
    weeklySales: weeklySales.map(s => ({
      date: s.saleDate,
      amount: Number(s._sum.totalAmount ?? 0),
      bottles: s._sum.quantityBottles ?? 0,
    })),
    topSellers: topSellersDetail,
    topSellersWeek,
    topSellersMonth,
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
