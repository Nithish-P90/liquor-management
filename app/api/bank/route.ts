import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [transactions, lockerTotal] = await Promise.all([
    prisma.bankTransaction.findMany({
      orderBy: { txDate: 'desc' },
      take: 50,
    }),
    // Locker balance = total ever sent to locker - total bank deposits - total KSBCL payments
    prisma.cashRecord.aggregate({ _sum: { cashToLocker: true } }),
  ])

  const totalToLocker = Number(lockerTotal._sum.cashToLocker ?? 0)
  const totalDeposited = transactions
    .filter(t => t.txType === 'DEPOSIT')
    .reduce((s, t) => s + Number(t.amount), 0)
  const totalKsbcl = transactions
    .filter(t => t.txType === 'KSBCL_PAYMENT')
    .reduce((s, t) => s + Number(t.amount), 0)

  const lockerBalance = totalToLocker - totalDeposited - totalKsbcl
  const bankBalance = totalDeposited - totalKsbcl

  return NextResponse.json({
    lockerBalance,
    bankBalance,
    totalDeposited,
    totalKsbcl,
    transactions,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { txDate, txType, amount, notes } = body

  const tx = await prisma.bankTransaction.create({
    data: {
      txDate: toUtcNoonDate(new Date(txDate + 'T12:00:00')),
      txType,
      amount: Number(amount),
      notes: notes || null,
    },
  })
  return NextResponse.json(tx)
}
