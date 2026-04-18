import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'
import { requireSession } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

type PaymentTotals = {
  cash: number
  card: number
  upi: number
  credit: number
}

type LedgerState = {
  openingRegister: number
  cashSales: number
  expenses: number
  cashToLocker: number
  closingRegister: number
  cardSales: number
  upiSales: number
  creditSales: number
  creditCollected: number
  availableBeforeTransfer: number
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function asMoney(value: unknown, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function hasDiff(a: number, b: number) {
  return Math.abs(a - b) > 0.009
}

async function getSystemPaymentTotals(recordDate: Date): Promise<PaymentTotals> {
  const dayStart = new Date(Date.UTC(recordDate.getUTCFullYear(), recordDate.getUTCMonth(), recordDate.getUTCDate(), 0, 0, 0, 0))
  const nextDayStart = new Date(Date.UTC(recordDate.getUTCFullYear(), recordDate.getUTCMonth(), recordDate.getUTCDate() + 1, 0, 0, 0, 0))
  const [sales, miscAgg] = await Promise.all([
    prisma.sale.findMany({
      where: { saleDate: { gte: dayStart, lt: nextDayStart } },
      select: {
        paymentMode: true,
        totalAmount: true,
        cashAmount: true,
        cardAmount: true,
        upiAmount: true,
      },
    }),
    prisma.miscSale.aggregate({ where: { saleDate: { gte: dayStart, lt: nextDayStart } }, _sum: { totalAmount: true } }),
  ])

  const totals: PaymentTotals = { cash: 0, card: 0, upi: 0, credit: 0 }

  for (const sale of sales) {
    const totalAmount = asMoney(sale.totalAmount)
    switch (sale.paymentMode) {
      case 'CASH':
        totals.cash += totalAmount
        break
      case 'CARD':
        totals.card += totalAmount
        break
      case 'UPI':
        totals.upi += totalAmount
        break
      case 'CREDIT':
        totals.credit += totalAmount
        break
      case 'SPLIT':
        totals.cash += asMoney(sale.cashAmount)
        totals.card += asMoney(sale.cardAmount)
        totals.upi += asMoney(sale.upiAmount)
        break
      case 'VOID': {
        // Refunds are paid in cash, so VOID always reduces cash tally.
        totals.cash += totalAmount
        break
      }
      default:
        break
    }
  }

  totals.cash += asMoney(miscAgg._sum.totalAmount)

  return {
    cash: round2(totals.cash),
    card: round2(totals.card),
    upi: round2(totals.upi),
    credit: round2(totals.credit),
  }
}

async function computeLedgerState(
  recordDate: Date,
  input: { requestedCashToLocker: number; requestedCreditCollected: number; strict: boolean }
): Promise<LedgerState> {
  const [previous, paymentTotals, expenseAgg] = await Promise.all([
    prisma.cashRecord.findFirst({
      where: { recordDate: { lt: recordDate } },
      orderBy: { recordDate: 'desc' },
      select: { closingRegister: true },
    }),
    getSystemPaymentTotals(recordDate),
    prisma.expenditure.aggregate({
      where: { expDate: recordDate },
      _sum: { amount: true },
    }),
  ])

  const openingRegister = round2(asMoney(previous?.closingRegister))
  const expenses = round2(asMoney(expenseAgg._sum.amount))
  const cashSales = round2(paymentTotals.cash)
  const cardSales = round2(paymentTotals.card)
  const upiSales = round2(paymentTotals.upi)
  const creditSales = round2(paymentTotals.credit)
  const creditCollected = round2(Math.max(0, input.requestedCreditCollected))

  const availableRaw = round2(openingRegister + cashSales + creditCollected - expenses)
  if (input.strict && availableRaw < -0.009) {
    throw new Error('Expenses exceed available register cash. Please verify expenditure entries and prior-day closing.')
  }

  const availableBeforeTransfer = round2(Math.max(0, availableRaw))
  const requestedCashToLocker = round2(Math.max(0, input.requestedCashToLocker))

  if (input.strict && requestedCashToLocker - availableBeforeTransfer > 0.009) {
    throw new Error(`Locker transfer exceeds available register cash (${availableBeforeTransfer.toFixed(2)}).`)
  }

  const cashToLocker = round2(Math.min(requestedCashToLocker, availableBeforeTransfer))
  const closingRegister = round2(availableBeforeTransfer - cashToLocker)

  return {
    openingRegister,
    cashSales,
    expenses,
    cashToLocker,
    closingRegister,
    cardSales,
    upiSales,
    creditSales,
    creditCollected,
    availableBeforeTransfer,
  }
}

export async function GET(req: NextRequest) {
  const [, err] = await requireSession()
  if (err) return err
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')

  if (date) {
    const recordDate = toUtcNoonDate(new Date(date + 'T12:00:00'))
    const existing = await prisma.cashRecord.findUnique({ where: { recordDate } })

    const ledger = await computeLedgerState(recordDate, {
      requestedCashToLocker: asMoney(existing?.cashToLocker),
      requestedCreditCollected: asMoney(existing?.creditCollected),
      strict: false,
    })

    if (existing) {
      const opening = asMoney(existing.openingRegister)
      const cashSales = asMoney(existing.cashSales)
      const expenses = asMoney(existing.expenses)
      const cashToLocker = asMoney(existing.cashToLocker)
      const closing = asMoney(existing.closingRegister)
      const card = asMoney(existing.cardSales)
      const upi = asMoney(existing.upiSales)
      const credit = asMoney(existing.creditSales)
      const creditCollected = asMoney(existing.creditCollected)

      if (
        hasDiff(opening, ledger.openingRegister) ||
        hasDiff(cashSales, ledger.cashSales) ||
        hasDiff(expenses, ledger.expenses) ||
        hasDiff(cashToLocker, ledger.cashToLocker) ||
        hasDiff(closing, ledger.closingRegister) ||
        hasDiff(card, ledger.cardSales) ||
        hasDiff(upi, ledger.upiSales) ||
        hasDiff(credit, ledger.creditSales) ||
        hasDiff(creditCollected, ledger.creditCollected)
      ) {
        await prisma.cashRecord.update({
          where: { id: existing.id },
          data: {
            openingRegister: ledger.openingRegister,
            cashSales: ledger.cashSales,
            expenses: ledger.expenses,
            cashToLocker: ledger.cashToLocker,
            closingRegister: ledger.closingRegister,
            cardSales: ledger.cardSales,
            upiSales: ledger.upiSales,
            creditSales: ledger.creditSales,
            creditCollected: ledger.creditCollected,
          },
        })
      }
    }

    return NextResponse.json({
      id: existing?.id ?? null,
      recordDate,
      openingRegister: ledger.openingRegister,
      cashSales: ledger.cashSales,
      expenses: ledger.expenses,
      cashToLocker: ledger.cashToLocker,
      closingRegister: ledger.closingRegister,
      cardSales: ledger.cardSales,
      upiSales: ledger.upiSales,
      creditSales: ledger.creditSales,
      creditCollected: ledger.creditCollected,
      notes: existing?.notes ?? '',
      maxTransfer: ledger.availableBeforeTransfer,
      autoComputed: true,
    })
  }

  const records = await prisma.cashRecord.findMany({
    orderBy: { recordDate: 'desc' },
    take: 30,
  })
  return NextResponse.json(records)
}

export async function POST(req: NextRequest) {
  const [, err] = await requireSession()
  if (err) return err

  const body = await req.json()
  const recordDate = typeof body?.recordDate === 'string' ? body.recordDate : ''
  if (!recordDate) {
    return NextResponse.json({ error: 'recordDate is required' }, { status: 400 })
  }

  const cashDate = toUtcNoonDate(new Date(recordDate + 'T12:00:00'))

  const existing = await prisma.cashRecord.findUnique({ where: { recordDate: cashDate } })
  const requestedCashToLocker = asMoney(body?.cashToLocker, asMoney(existing?.cashToLocker))
  const requestedCreditCollected = asMoney(body?.creditCollected, asMoney(existing?.creditCollected))

  let ledger: LedgerState
  try {
    ledger = await computeLedgerState(cashDate, {
      requestedCashToLocker,
      requestedCreditCollected,
      strict: true,
    })
  } catch (computeError) {
    const message = computeError instanceof Error ? computeError.message : 'Failed to validate cash ledger'
    return NextResponse.json({ error: message }, { status: 409 })
  }

  const notes = typeof body?.notes === 'string' ? body.notes : (existing?.notes ?? null)

  const record = await prisma.cashRecord.upsert({
    where: { recordDate: cashDate },
    update: {
      openingRegister: ledger.openingRegister,
      cashSales: ledger.cashSales,
      expenses: ledger.expenses,
      cashToLocker: ledger.cashToLocker,
      closingRegister: ledger.closingRegister,
      cardSales: ledger.cardSales,
      upiSales: ledger.upiSales,
      creditSales: ledger.creditSales,
      creditCollected: ledger.creditCollected,
      notes,
    },
    create: {
      recordDate: cashDate,
      openingRegister: ledger.openingRegister,
      cashSales: ledger.cashSales,
      expenses: ledger.expenses,
      cashToLocker: ledger.cashToLocker,
      closingRegister: ledger.closingRegister,
      cardSales: ledger.cardSales,
      upiSales: ledger.upiSales,
      creditSales: ledger.creditSales,
      creditCollected: ledger.creditCollected,
      notes,
    },
  })
  return NextResponse.json({
    ...record,
    maxTransfer: ledger.availableBeforeTransfer,
    autoComputed: true,
  })
}
