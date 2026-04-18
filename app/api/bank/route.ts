import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'
import { requireSession, requireAdmin } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [, err] = await requireSession()
  if (err) return err

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
  const [, authErr] = await requireAdmin()
  if (authErr) return authErr

  const body = await req.json()
  const { txDate, txType, amount, notes } = body

  if (!txDate || !txType || !['DEPOSIT', 'KSBCL_PAYMENT'].includes(txType)) {
    return NextResponse.json({ error: 'Valid txDate and txType (DEPOSIT or KSBCL_PAYMENT) required' }, { status: 400 })
  }
  const parsedAmount = Number(amount)
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
  }

  const [transactions, lockerTotal] = await Promise.all([
    prisma.bankTransaction.findMany({
      select: { txType: true, amount: true },
    }),
    prisma.cashRecord.aggregate({ _sum: { cashToLocker: true } }),
  ])

  const totalToLocker = Number(lockerTotal._sum.cashToLocker ?? 0)
  const totalDeposited = transactions
    .filter(t => t.txType === 'DEPOSIT')
    .reduce((sum, t) => sum + Number(t.amount), 0)
  const totalKsbcl = transactions
    .filter(t => t.txType === 'KSBCL_PAYMENT')
    .reduce((sum, t) => sum + Number(t.amount), 0)

  const lockerBalance = totalToLocker - totalDeposited - totalKsbcl
  const bankBalance = totalDeposited - totalKsbcl

  if (txType === 'DEPOSIT' && parsedAmount - lockerBalance > 0.009) {
    return NextResponse.json(
      { error: `Deposit exceeds locker balance (${lockerBalance.toFixed(2)})` },
      { status: 409 }
    )
  }

  if (txType === 'KSBCL_PAYMENT' && parsedAmount - bankBalance > 0.009) {
    return NextResponse.json(
      { error: `KSBCL payment exceeds bank balance (${bankBalance.toFixed(2)})` },
      { status: 409 }
    )
  }

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
