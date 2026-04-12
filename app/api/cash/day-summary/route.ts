import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'
import { StockEntryType } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dateStr = searchParams.get('date')
  if (!dateStr) return NextResponse.json({ error: 'Date is required' }, { status: 400 })

  const date = toUtcNoonDate(new Date(dateStr + 'T12:00:00'))

  const [sales, expenses, session] = await Promise.all([
    prisma.sale.findMany({ where: { saleDate: date } }),
    prisma.expenditure.findMany({ where: { expDate: date } }),
    prisma.inventorySession.findFirst({
      where: { periodStart: { lte: date }, periodEnd: { gte: date } },
      orderBy: { createdAt: 'desc' }
    })
  ])

  const paymentTotals = {
    cash: 0,
    card: 0,
    upi: 0,
    credit: 0,
    split: 0
  }

  sales.forEach(s => {
    const amount = Number(s.totalAmount)
    switch (s.paymentMode) {
      case 'CASH': paymentTotals.cash += amount; break
      case 'CARD': paymentTotals.card += amount; break
      case 'UPI': paymentTotals.upi += amount; break
      case 'CREDIT': paymentTotals.credit += amount; break
      case 'SPLIT': paymentTotals.split += amount; break
    }
  })

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
    where: { saleDate: date },
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