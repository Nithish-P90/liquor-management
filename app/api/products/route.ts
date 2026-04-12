import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') ?? ''
  const category = searchParams.get('category')

  const products = await prisma.product.findMany({
    where: {
      ...(q && { name: { contains: q, mode: 'insensitive' } }),
      ...(category && { category: category as any }),
    },
    include: { sizes: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })
  return NextResponse.json(products)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { itemCode, name, category, sizes } = body

  const product = await prisma.product.create({
    data: {
      itemCode,
      name,
      category,
      sizes: {
        create: sizes.map((s: any) => ({
          sizeMl: s.sizeMl,
          bottlesPerCase: s.bottlesPerCase,
          barcode: s.barcode || null,
          mrp: s.mrp,
          sellingPrice: s.sellingPrice,
        })),
      },
    },
    include: { sizes: true },
  })
  return NextResponse.json(product)
}
