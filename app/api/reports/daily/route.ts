import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Build the last 60 days as candidate dates
    const today = toUtcNoonDate(new Date())
    const dates: Date[] = []
    for (let i = 0; i < 60; i++) {
      const d = new Date(today)
      d.setUTCDate(d.getUTCDate() - i)
      dates.push(d)
    }

    // Find which dates actually have data (sales, expenses, or attendance)
    const [salesDates, expDates, attDates] = await Promise.all([
      prisma.sale.groupBy({
        by: ['saleDate'],
        where: { saleDate: { gte: dates[dates.length - 1], lte: today }, quantityBottles: { gt: 0 } },
        _sum: { totalAmount: true, quantityBottles: true },
        _count: { _all: true },
      }),
      prisma.expenditure.groupBy({
        by: ['expDate'],
        where: { expDate: { gte: dates[dates.length - 1], lte: today } },
        _sum: { amount: true },
      }),
      prisma.attendanceLog.groupBy({
        by: ['date'],
        where: { date: { gte: dates[dates.length - 1], lte: today } },
        _count: { _all: true },
      }),
    ])

    // Build a set of all dates with any activity
    const activeDates = new Set<string>()
    // Always include today
    activeDates.add(today.toISOString())
    for (const s of salesDates) activeDates.add(new Date(s.saleDate).toISOString())
    for (const e of expDates)   activeDates.add(new Date(e.expDate).toISOString())
    for (const a of attDates)   activeDates.add(new Date(a.date).toISOString())

    if (activeDates.size === 0) {
      return NextResponse.json([])
    }

    // Build lookup maps
    const salesMap = new Map<string, { total: number; bottles: number; bills: number; byMode: Record<string, number> }>()
    for (const g of salesDates) {
      const key = new Date(g.saleDate).toISOString()
      salesMap.set(key, {
        total: Number(g._sum.totalAmount ?? 0),
        bottles: g._sum.quantityBottles ?? 0,
        bills: g._count._all,
        byMode: {},
      })
    }

    const expMap = new Map<string, number>()
    for (const e of expDates) expMap.set(new Date(e.expDate).toISOString(), Number(e._sum.amount ?? 0))

    // For each active date get per-mode sales breakdown
    const activeDateArr = Array.from(activeDates)
      .map(iso => new Date(iso))
      .sort((a, b) => b.getTime() - a.getTime())

    const results = await Promise.all(activeDateArr.map(async date => {
      const key = date.toISOString()
      const isLive = date.getTime() === today.getTime()

      // Per-mode aggregation for this date
      const modeAgg = await prisma.sale.groupBy({
        by: ['paymentMode'],
        where: { saleDate: date, quantityBottles: { gt: 0 } },
        _sum: { totalAmount: true, quantityBottles: true, cashAmount: true, cardAmount: true, upiAmount: true },
        _count: { _all: true },
      })

      const salesByMode: Record<string, number> = { CASH: 0, UPI: 0, CARD: 0, CREDIT: 0, SPLIT: 0 }
      let totalSales = 0, totalBottles = 0, totalBills = 0

      for (const g of modeAgg) {
        const amount = Number(g._sum.totalAmount ?? 0)
        if (g.paymentMode === 'SPLIT') {
          salesByMode.CASH += Number(g._sum.cashAmount ?? 0)
          salesByMode.CARD += Number(g._sum.cardAmount ?? 0)
          salesByMode.UPI  += Number(g._sum.upiAmount  ?? 0)
        } else {
          salesByMode[g.paymentMode] = (salesByMode[g.paymentMode] ?? 0) + amount
        }
        totalSales   += amount
        totalBottles += g._sum.quantityBottles ?? 0
        totalBills   += g._count._all
      }

      const totalExpenses = expMap.get(key) ?? 0

      // Count unsettled pending bills created on this date
      const pendingUnpaid = await prisma.pendingBill.count({
        where: { saleDate: date, settled: false },
      })
      const pendingTotal = await prisma.pendingBill.aggregate({
        where: { saleDate: date, settled: false },
        _sum: { totalAmount: true },
      })

      return {
        date,
        isLive,
        financials: {
          totalSales,
          totalExpenses,
          netCash: salesByMode.CASH - totalExpenses,
          salesByMode,
          totalBottlesSold: totalBottles,
          totalBills,
          pendingUnpaid,
          pendingUnpaidAmount: Number(pendingTotal._sum.totalAmount ?? 0),
        },
      }
    }))

    return NextResponse.json(results)
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to fetch daily ledger' }, { status: 500 })
  }
}
