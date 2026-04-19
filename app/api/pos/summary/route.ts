import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { StockEntryType } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { ensureDailyRollover } from '@/lib/rollover'
import { aggregateMiscSalesForScope, resolveMiscSalesDay } from '@/lib/misc-sales'

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

function getClerkLabel(staff: { name: string; role?: string }) {
  return staff.role === 'CASHIER' ? 'Counter' : staff.name
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await ensureDailyRollover()

  const user = session.user as SessionUser
  const staffId = user.id ? parseInt(user.id) : 0
  const isStaff = user.role === 'STAFF'
  const miscScope = resolveMiscSalesDay()
  const today = miscScope.day

  const latestSession = await prisma.inventorySession.findFirst({
    include: { createdBy: { select: { name: true } } },
    orderBy: { periodStart: 'desc' },
  })

  const saleWhere = {
    saleDate: today,
    productSize: { product: { category: { not: 'MISCELLANEOUS' } } },
    ...(isStaff && staffId ? { staffId } : {}),
  }

  const [cashAgg, cardAgg, upiAgg, creditAgg, splitAgg, voidAgg, recentLines, openingEntries, closingEntries, miscSummary] = await Promise.all([
    prisma.sale.aggregate({
      where: { ...saleWhere, paymentMode: 'CASH' },
      _sum: { totalAmount: true, quantityBottles: true },
      _count: { _all: true },
    }),
    prisma.sale.aggregate({
      where: { ...saleWhere, paymentMode: 'CARD' },
      _sum: { totalAmount: true, quantityBottles: true },
      _count: { _all: true },
    }),
    prisma.sale.aggregate({
      where: { ...saleWhere, paymentMode: 'UPI' },
      _sum: { totalAmount: true, quantityBottles: true },
      _count: { _all: true },
    }),
    prisma.sale.aggregate({
      where: { ...saleWhere, paymentMode: 'CREDIT' },
      _sum: { totalAmount: true, quantityBottles: true },
      _count: { _all: true },
    }),
    prisma.sale.aggregate({
      where: { ...saleWhere, paymentMode: 'SPLIT' },
      _sum: { totalAmount: true, quantityBottles: true, cashAmount: true, cardAmount: true, upiAmount: true },
      _count: { _all: true },
    }),
    prisma.sale.aggregate({
      where: { ...saleWhere, paymentMode: 'VOID' },
      _sum: { totalAmount: true, quantityBottles: true, cashAmount: true, cardAmount: true, upiAmount: true },
      _count: { _all: true },
    }),
    prisma.sale.findMany({
      where: { ...saleWhere, quantityBottles: { gt: 0 } },
      include: {
        productSize: { include: { product: true } },
        staff: { select: { id: true, name: true, role: true } },
      },
      orderBy: [{ saleTime: 'desc' }, { id: 'desc' }],
      take: 160,
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
    aggregateMiscSalesForScope(miscScope, isStaff && staffId ? staffId : null),
  ])

  const paymentTotals = {
    CASH: Number(cashAgg._sum.totalAmount ?? 0) + Number(splitAgg._sum.cashAmount ?? 0) + Number(voidAgg._sum.totalAmount ?? 0),
    CARD: Number(cardAgg._sum.totalAmount ?? 0) + Number(splitAgg._sum.cardAmount ?? 0),
    UPI: Number(upiAgg._sum.totalAmount ?? 0) + Number(splitAgg._sum.upiAmount ?? 0),
    CREDIT: Number(creditAgg._sum.totalAmount ?? 0),
    SPLIT: 0,
  }

  const recentBillMap = new Map<string, {
    id: string
    saleTime: Date
    clerkName: string
    paymentMode: string
    quantityBottles: number
    totalAmount: number
    items: Array<{
      saleId: number
      productSizeId: number
      productName: string
      sizeMl: number
      quantityBottles: number
      totalAmount: number
    }>
  }>()

  for (const sale of recentLines) {
    const billKey = `${sale.staffId}:${sale.saleTime.toISOString()}`
    const existing = recentBillMap.get(billKey)
    if (!existing) {
      recentBillMap.set(billKey, {
        id: billKey,
        saleTime: sale.saleTime,
        clerkName: getClerkLabel(sale.staff),
        paymentMode: sale.paymentMode,
        quantityBottles: sale.quantityBottles,
        totalAmount: Number(sale.totalAmount),
        items: [{
          saleId: sale.id,
          productSizeId: sale.productSizeId,
          productName: sale.productSize.product.name,
          sizeMl: sale.productSize.sizeMl,
          quantityBottles: sale.quantityBottles,
          totalAmount: Number(sale.totalAmount),
        }],
      })
      continue
    }

    existing.quantityBottles += sale.quantityBottles
    existing.totalAmount += Number(sale.totalAmount)
    if (existing.paymentMode !== sale.paymentMode) existing.paymentMode = 'MIXED'
    existing.items.push({
      saleId: sale.id,
      productSizeId: sale.productSizeId,
      productName: sale.productSize.product.name,
      sizeMl: sale.productSize.sizeMl,
      quantityBottles: sale.quantityBottles,
      totalAmount: Number(sale.totalAmount),
    })
  }

  const recentBills = Array.from(recentBillMap.values())
    .sort((a, b) => b.saleTime.getTime() - a.saleTime.getTime())
    .slice(0, 12)

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
      bills: cashAgg._count._all + cardAgg._count._all + upiAgg._count._all + creditAgg._count._all + splitAgg._count._all + voidAgg._count._all,
      bottles:
        Number(cashAgg._sum.quantityBottles ?? 0) +
        Number(cardAgg._sum.quantityBottles ?? 0) +
        Number(upiAgg._sum.quantityBottles ?? 0) +
        Number(creditAgg._sum.quantityBottles ?? 0) +
        Number(splitAgg._sum.quantityBottles ?? 0) +
        Number(voidAgg._sum.quantityBottles ?? 0),
      amount: paymentTotals.CASH + paymentTotals.CARD + paymentTotals.UPI + paymentTotals.CREDIT,
      paymentTotals,
    },
    todayMiscSales: {
      totalAmount: miscSummary.totalAmount,
      items: miscSummary.items,
      entries: miscSummary.entries,
    },
    recentBills: recentBills.map(bill => ({
      id: bill.id,
      saleTime: bill.saleTime,
      clerkName: bill.clerkName,
      paymentMode: bill.paymentMode,
      quantityBottles: bill.quantityBottles,
      totalAmount: bill.totalAmount,
      lines: bill.items.length,
      items: bill.items,
    })),
    // Backward compatibility for screens that still consume line-level recents
    recentSales: recentLines.slice(0, 12).map(sale => ({
      id: sale.id,
      saleTime: sale.saleTime,
      productName: sale.productSize.product.name,
      sizeMl: sale.productSize.sizeMl,
      quantityBottles: sale.quantityBottles,
      totalAmount: Number(sale.totalAmount),
      paymentMode: sale.paymentMode,
      scanMethod: sale.scanMethod,
      staffName: getClerkLabel(sale.staff),
    })),
  })
}
