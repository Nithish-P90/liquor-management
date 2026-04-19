import { NextRequest, NextResponse } from 'next/server'
import { Category } from '@prisma/client'
import prisma from '@/lib/prisma'
import { requireSession, requireAdmin } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

const VALID_CATEGORIES = new Set(Object.values(Category))

export async function GET(req: NextRequest) {
  const [, err] = await requireSession()
  if (err) return err

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') ?? ''
  const category = searchParams.get('category')

  const validCategory = category && VALID_CATEGORIES.has(category as Category)
    ? (category as Category)
    : undefined

  const products = await prisma.product.findMany({
    where: {
      category: validCategory ?? { not: 'MISCELLANEOUS' },
      ...(q && { name: { contains: q, mode: 'insensitive' } }),
    },
    include: { sizes: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })
  return NextResponse.json(products)
}

export async function POST(req: NextRequest) {
  const [, err] = await requireAdmin()
  if (err) return err

  const body = await req.json()
  const { itemCode, name, category, sizes } = body

  if (!itemCode || typeof itemCode !== 'string') {
    return NextResponse.json({ error: 'itemCode is required' }, { status: 400 })
  }
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!category || !VALID_CATEGORIES.has(category)) {
    return NextResponse.json({ error: 'Valid category is required' }, { status: 400 })
  }
  if (!Array.isArray(sizes) || sizes.length === 0) {
    return NextResponse.json({ error: 'At least one size is required' }, { status: 400 })
  }

  const product = await prisma.product.create({
    data: {
      itemCode,
      name,
      category,
      sizes: {
        create: sizes.map((s: { sizeMl: number; bottlesPerCase: number; barcode?: string; mrp: number; sellingPrice: number }) => ({
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
