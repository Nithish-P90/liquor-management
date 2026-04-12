import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { PaymentMode, StockEntryType } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'

export const dynamic = 'force-dynamic'

type SessionUser = {
  id?: string
  role?: string
}

type StockEntrySummary = {
  lines: number
  bottles: number
}

function summarizeStockEntries(entries: { totalBottles: number }[]): StockEntrySummary {
  return {
    lines: entries.filter(entry => entry.totalBottles > 0).length,
    bottles: entries.reduce((sum, entry) => sum + entry.totalBottles, 0),
  }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = session.user as SessionUser
  const staffId = user.id ? parseInt(user.id) : 0
  const isStaff = user.role === 'STAFF'
  const today = toUtcNoonDate(new Date())

  const latestSession = await prisma.inventorySession.findFirst({
    include: { createdBy: { select: { name: true } } },
    orderBy: { periodStart: 'desc' },
  })

  const saleWhere = {
    saleDate: today,
    ...(isStaff && staffId ? { staffId } : {}),
  }

  const [salesAgg, recentSales, openingEntries, closingEntries] = await Promise.all([
    prisma.sale.groupBy({
      by: ['paymentMode'],
      where: saleWhere,
      _sum: { totalAmount: true, quantityBottles: true },
      _count: { _all: true },
    }),
    prisma.sale.findMany({
      where: saleWhere,
      include: {
        productSize: { include: { product: true } },
        staff: { select: { id: true, name: true } },
      },
      orderBy: { saleTime: 'desc' },
      take: 12,
    }),
    latestSession
      ? prisma.stockEntry.findMany({
          where: { sessionId: latestSession.id, entryType: StockEntryType.OPENING },
          select: { totalBottles: true },
        })
      : Promise.resolve([]),
    latestSession
      ? prisma.stockEntry.findMany({
          where: { sessionId: latestSession.id, entryType: StockEntryType.CLOSING },
          select: { totalBottles: true },
        })
      : Promise.resolve([]),
  ])

  const paymentTotals = Object.values(PaymentMode).reduce<Record<PaymentMode, number>>(
    (totals, mode) => {
      totals[mode] = Number(salesAgg.find(row => row.paymentMode === mode)?._sum.totalAmount ?? 0)
      return totals
    },
    {
      CASH: 0,
      CARD: 0,
      UPI: 0,
      CREDIT: 0,
      SPLIT: 0,
    }
  )

  return NextResponse.json({
    scope: isStaff ? 'STAFF' : 'OWNER',
    staff: {
      id: staffId,
      name: session.user?.name ?? 'Staff',
      role: user.role ?? 'STAFF',
    },
    currentSession: latestSession
      ? {
          id: latestSession.id,
          periodStart: latestSession.periodStart,
          periodEnd: latestSession.periodEnd,
          locked: latestSession.locked,
          createdBy: latestSession.createdBy.name,
        }
      : null,
    openingStock: summarizeStockEntries(openingEntries),
    closingStock: summarizeStockEntries(closingEntries),
    todaySales: {
      bills: salesAgg.reduce((sum, row) => sum + row._count._all, 0),
      bottles: salesAgg.reduce((sum, row) => sum + (row._sum.quantityBottles ?? 0), 0),
      amount: (Object.values(paymentTotals) as number[]).reduce((sum, amount) => sum + amount, 0),
      paymentTotals,
    },
    recentSales: recentSales.map(sale => ({
      id: sale.id,
      saleTime: sale.saleTime,
      productName: sale.productSize.product.name,
      sizeMl: sale.productSize.sizeMl,
      quantityBottles: sale.quantityBottles,
      totalAmount: Number(sale.totalAmount),
      paymentMode: sale.paymentMode,
      scanMethod: sale.scanMethod,
      staffName: sale.staff.name,
    })),
  })
}
