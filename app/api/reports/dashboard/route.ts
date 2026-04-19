export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { subtractDays } from '@/lib/date-utils'
import { aggregateMiscSalesForScope, resolveMiscSalesDay } from '@/lib/misc-sales'

export async function GET() {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string } | undefined

  if (!session || user?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Owner dashboard is admin only' }, { status: 403 })
  }

  const miscScope = resolveMiscSalesDay()
  const today = miscScope.day

  const todayRows = await prisma.sale.findMany({
    where: { saleDate: today, productSize: { product: { category: { not: 'MISCELLANEOUS' } } } },
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

  // Today's sales with split allocation into cash/card/upi and refund netting
  const todaySales = {
    total: 0,
    bottles: 0,
    cash: 0,
    card: 0,
    upi: 0,
  }

  for (const sale of todayRows) {
    const saleAmount = Number(sale.totalAmount)
    const isRefund = sale.paymentMode === 'VOID' || sale.quantityBottles < 0

    if (sale.paymentMode === 'SPLIT') {
      todaySales.total += saleAmount
      todaySales.bottles += sale.quantityBottles
      todaySales.cash += Number(sale.cashAmount ?? 0)
      todaySales.card += Number(sale.cardAmount ?? 0)
      todaySales.upi += Number(sale.upiAmount ?? 0)
    } else if (sale.paymentMode === 'CASH') {
      todaySales.total += saleAmount
      todaySales.bottles += sale.quantityBottles
      todaySales.cash += saleAmount
    } else if (sale.paymentMode === 'CARD') {
      todaySales.total += saleAmount
      todaySales.bottles += sale.quantityBottles
      todaySales.card += saleAmount
    } else if (sale.paymentMode === 'UPI') {
      todaySales.total += saleAmount
      todaySales.bottles += sale.quantityBottles
      todaySales.upi += saleAmount
    } else if (sale.paymentMode === 'VOID') {
      todaySales.total += saleAmount
      todaySales.bottles += sale.quantityBottles
      todaySales.cash += Number(sale.cashAmount ?? 0)
      todaySales.card += Number(sale.cardAmount ?? 0)
      todaySales.upi += Number(sale.upiAmount ?? 0)
    }

    const isCounter = sale.staff.role === 'CASHIER'
    const key = isCounter ? 'COUNTER' : `STAFF:${sale.staffId}`
    const label = isCounter ? 'Counter' : sale.staff.name
    const existing = clerkMap.get(key)
    if (!existing) {
      clerkMap.set(key, {
        staffId: isCounter ? 0 : sale.staffId,
        name: label,
        billKeys: new Set(isRefund ? [] : [`${sale.staffId}:${sale.saleTime.toISOString()}`]),
        bottles: isRefund ? 0 : sale.quantityBottles,
        amount: saleAmount,
      })
      continue
    }
    if (!isRefund) {
      existing.billKeys.add(`${sale.staffId}:${sale.saleTime.toISOString()}`)
      existing.bottles += sale.quantityBottles
    }
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

  const sevenDaysAgo  = subtractDays(today, 6)
  const thirtyDaysAgo = subtractDays(today, 29)

  // Fire all independent queries in parallel
  const [
    alerts, highAlerts, pendingIndents, weeklySales,
    topSellersToday, topSellersWeekRaw, topSellersMonthRaw,
    recentAlerts, miscSummary,
  ] = await Promise.all([
    prisma.varianceRecord.count({ where: { resolved: false, severity: { not: 'OK' } } }),
    prisma.varianceRecord.count({ where: { resolved: false, severity: 'HIGH' } }),
    prisma.indent.count({ where: { status: 'PENDING' } }),
    prisma.sale.groupBy({
      by: ['saleDate'],
      where: { saleDate: { gte: sevenDaysAgo, lte: today }, productSize: { product: { category: { not: 'MISCELLANEOUS' } } } },
      _sum: { totalAmount: true, quantityBottles: true },
      _count: { id: true },
      orderBy: { saleDate: 'asc' },
    }),
    prisma.sale.groupBy({
      by: ['productSizeId'],
      where: { saleDate: today, quantityBottles: { not: 0 }, productSize: { product: { category: { not: 'MISCELLANEOUS' } } } },
      _sum: { quantityBottles: true, totalAmount: true },
      _count: { id: true },
      orderBy: { _sum: { quantityBottles: 'desc' } },
      take: 8,
    }),
    prisma.sale.groupBy({
      by: ['productSizeId'],
      where: { saleDate: { gte: sevenDaysAgo, lte: today }, quantityBottles: { not: 0 }, productSize: { product: { category: { not: 'MISCELLANEOUS' } } } },
      _sum: { quantityBottles: true, totalAmount: true },
      _count: { id: true },
      orderBy: { _sum: { quantityBottles: 'desc' } },
      take: 8,
    }),
    prisma.sale.groupBy({
      by: ['productSizeId'],
      where: { saleDate: { gte: thirtyDaysAgo, lte: today }, quantityBottles: { not: 0 }, productSize: { product: { category: { not: 'MISCELLANEOUS' } } } },
      _sum: { quantityBottles: true, totalAmount: true },
      _count: { id: true },
      orderBy: { _sum: { quantityBottles: 'desc' } },
      take: 8,
    }),
    prisma.varianceRecord.findMany({
      where: { resolved: false, severity: { not: 'OK' }, productSize: { product: { category: { not: 'MISCELLANEOUS' } } } },
      include: { productSize: { include: { product: true } } },
      orderBy: [{ severity: 'desc' }, { recordDate: 'desc' }],
      take: 5,
    }),
    aggregateMiscSalesForScope(miscScope),
  ])

  const miscSaleTotal = miscSummary.totalAmount

  // Resolve all three top-seller sets with a single shared productSize lookup
  const allIds = [...new Set([
    ...topSellersToday.map(r => r.productSizeId),
    ...topSellersWeekRaw.map(r => r.productSizeId),
    ...topSellersMonthRaw.map(r => r.productSizeId),
  ])]
  const allSizes = await prisma.productSize.findMany({ where: { id: { in: allIds } }, include: { product: true } })
  const sizeMap = Object.fromEntries(allSizes.map(s => [s.id, s]))

  function mapSellers(rows: typeof topSellersToday) {
    return rows.map(t => {
      const ps = sizeMap[t.productSizeId]
      return { name: ps?.product.name ?? 'Unknown', sizeMl: ps?.sizeMl ?? 0, bottles: t._sum.quantityBottles ?? 0, amount: Number(t._sum.totalAmount ?? 0), txCount: t._count.id }
    })
  }

  const topSellersDetail = mapSellers(topSellersToday)
  const topSellersWeek   = mapSellers(topSellersWeekRaw)
  const topSellersMonth  = mapSellers(topSellersMonthRaw)

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
