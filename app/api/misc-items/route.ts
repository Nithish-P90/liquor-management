import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const barcode = req.nextUrl.searchParams.get('barcode')
  if (!barcode) return NextResponse.json(null)
  const item = await prisma.miscItem.findUnique({ where: { barcode } })
  return NextResponse.json(item)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const item = await prisma.miscItem.create({
    data: {
      barcode: body.barcode,
      name: body.name,
      category: body.category,
      price: body.price,
    },
  })
  return NextResponse.json(item)
}
