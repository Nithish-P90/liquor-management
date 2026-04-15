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
    where: { saleDate: today, paymentMode: { not: 'VOID' } },
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
    credit: 0,
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
    } else if (sale.paymentMode === 'CREDIT') {
      todaySales.credit += saleAmount
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
