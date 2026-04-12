import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')

  if (date) {
    const recordDate = toUtcNoonDate(new Date(date + 'T12:00:00'))
    const record = await prisma.cashRecord.findUnique({ where: { recordDate } })
    if (record) return NextResponse.json(record)

    // Carry forward previous day's closing register as today's opening
    const previous = await prisma.cashRecord.findFirst({
      where: { recordDate: { lt: recordDate } },
      orderBy: { recordDate: 'desc' },
    })

    return NextResponse.json({
      recordDate,
      openingRegister: Number(previous?.closingRegister ?? 0),
      cashSales: 0,
      expenses: 0,
      cashToLocker: 0,
      closingRegister: 0,
      cardSales: 0,
      upiSales: 0,
      creditSales: 0,
      creditCollected: 0,
      notes: '',
    })
  }

  const records = await prisma.cashRecord.findMany({
    orderBy: { recordDate: 'desc' },
    take: 30,
  })
  return NextResponse.json(records)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    recordDate, openingRegister, cashSales, expenses, cashToLocker,
    closingRegister, cardSales, upiSales, creditSales, creditCollected, notes,
  } = body

  const cashDate = toUtcNoonDate(new Date(recordDate + 'T12:00:00'))

  const record = await prisma.cashRecord.upsert({
    where: { recordDate: cashDate },
    update: {
      openingRegister, cashSales, expenses, cashToLocker,
      closingRegister, cardSales, upiSales, creditSales, creditCollected, notes,
    },
    create: {
      recordDate: cashDate,
      openingRegister, cashSales, expenses, cashToLocker,
      closingRegister, cardSales, upiSales, creditSales, creditCollected, notes,
    },
  })
  return NextResponse.json(record)
}
