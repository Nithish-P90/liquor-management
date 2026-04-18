import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireSession, requireAdmin } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const [, err] = await requireSession()
  if (err) return err

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const expenses = await prisma.expenditure.findMany({
    where: {
      ...(from && to && { expDate: { gte: new Date(from), lte: new Date(to) } }),
    },
    orderBy: { expDate: 'desc' },
  })
  return NextResponse.json(expenses)
}

export async function POST(req: NextRequest) {
  const [, err] = await requireSession()
  if (err) return err

  const body = await req.json()
  const { expDate, particulars, category, amount } = body

  if (!expDate || !particulars || typeof particulars !== 'string') {
    return NextResponse.json({ error: 'expDate and particulars are required' }, { status: 400 })
  }
  const parsedAmount = Number(amount)
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
  }

  const expense = await prisma.expenditure.create({
    data: { expDate: new Date(expDate), particulars, category: category ?? 'OTHER', amount: parsedAmount },
  })
  return NextResponse.json(expense)
}

export async function DELETE(req: NextRequest) {
  const [, err] = await requireAdmin()
  if (err) return err

  const { searchParams } = new URL(req.url)
  const id = parseInt(searchParams.get('id') ?? '0')
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Valid id is required' }, { status: 400 })
  }
  await prisma.expenditure.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
