import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { StockEntryType } from '@prisma/client'
import { aggregateMiscSalesForScope, resolveMiscSalesDay } from '@/lib/misc-sales'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dateStr = searchParams.get('date')
  if (!dateStr) return NextResponse.json({ error: 'Date is required' }, { status: 400 })

  let scope: ReturnType<typeof resolveMiscSalesDay>
  try {
    scope = resolveMiscSalesDay(dateStr)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid date'
    return NextResponse.json({ error: message }, { status: 400 })
  }
  const date = scope.day

  const [sales, expenses, session, miscSummary] = await Promise.all([
    prisma.sale.findMany({ where: { saleDate: { gte: scope.dayStart, lt: scope.nextDayStart } } }),
    prisma.expenditure.findMany({ where: { expDate: date } }),
    prisma.inventorySession.findFirst({
      where: { periodStart: { lte: date }, periodEnd: { gte: date } },
      orderBy: { createdAt: 'desc' }
    }),
    aggregateMiscSalesForScope(scope),
  ])

  const paymentTotals = {
    cash: 0,
    card: 0,
    upi: 0,
    credit: 0,
    split: 0,
    misc: 0,
  }

  sales.forEach(s => {
    const amount = Number(s.totalAmount)
    switch (s.paymentMode) {
      case 'CASH': paymentTotals.cash += amount; break
      case 'CARD': paymentTotals.card += amount; break
      case 'UPI': paymentTotals.upi += amount; break
      case 'CREDIT': paymentTotals.credit += amount; break
      case 'SPLIT':
        paymentTotals.cash += Number(s.cashAmount ?? 0)
        paymentTotals.card += Number(s.cardAmount ?? 0)
        paymentTotals.upi += Number(s.upiAmount ?? 0)
        paymentTotals.split += 0
        break
      case 'VOID': {
        // Refunds are paid in cash, so VOID always reduces cash tally.
        paymentTotals.cash += amount
        break
      }
    }
  })

  const miscSalesTotal = miscSummary.totalAmount
  const miscItems = miscSummary.items
  paymentTotals.misc = miscSalesTotal

  const closingStock = {
    taken: false,
    sessionId: session?.id || null,
    periodStart: session?.periodStart || null,
    periodEnd: session?.periodEnd || null,
    lines: 0,
    bottles: 0
  }

  if (session) {
    const entries = await prisma.stockEntry.findMany({
      where: { sessionId: session.id, entryType: StockEntryType.CLOSING }
    })
    if (entries.length > 0) {
      closingStock.taken = true
      closingStock.lines = entries.length
      closingStock.bottles = entries.reduce((sum, e) => sum + e.totalBottles, 0)
    }
  }

  const lastSale = sales.length > 0 ? await prisma.sale.findFirst({
    where: { saleDate: { gte: scope.dayStart, lt: scope.nextDayStart } },
    orderBy: { saleTime: 'desc' },
    include: { productSize: { include: { product: true } } }
  }) : null

  return NextResponse.json({
    date: dateStr,
    sales: {
      bills: sales.length,
      bottles: sales.reduce((sum, s) => sum + s.quantityBottles, 0),
      totalAmount: sales.reduce((sum, s) => sum + Number(s.totalAmount), 0),
      paymentTotals
    },
    miscSales: {
      totalAmount: miscSalesTotal,
      items: miscItems,
      entries: miscSummary.entries,
    },
    lastSale: lastSale ? {
      id: lastSale.id,
      saleTime: lastSale.saleTime,
      paymentMode: lastSale.paymentMode,
      totalAmount: Number(lastSale.totalAmount),
      quantityBottles: lastSale.quantityBottles,
      productName: lastSale.productSize.product.name,
      sizeMl: lastSale.productSize.sizeMl
    } : null,
    expenses: {
      total: expenses.reduce((sum, e) => sum + Number(e.amount), 0),
      count: expenses.length,
      items: expenses.map(e => ({
        id: e.id,
        expDate: e.expDate,
        particulars: e.particulars,
        category: e.category,
        amount: Number(e.amount)
      }))
    },
    closingStock
  })
}