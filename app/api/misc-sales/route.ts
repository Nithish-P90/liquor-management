import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const dateParam = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10)
  const saleDate = new Date(dateParam + 'T00:00:00Z')
  const sales = await prisma.miscSale.findMany({
    where: { saleDate },
    include: { item: true },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(sales)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const saleDate = new Date(body.saleDate + 'T00:00:00Z')
  const now = new Date()
  const created = await prisma.$transaction(
    body.items.map((item: { itemId: number; quantity: number; unitPrice: number; totalAmount: number }) =>
      prisma.miscSale.create({
        data: {
          itemId: item.itemId,
          saleDate,
          saleTime: now,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalAmount: item.totalAmount,
          paymentMode: body.paymentMode,
        },
      })
    )
  )
  return NextResponse.json({ count: created.length })
}
