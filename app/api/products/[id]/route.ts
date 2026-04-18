import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireAdmin } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// PATCH /api/products/:id
// Updates product name, itemCode, category, and per-size mrp/sellingPrice/barcode
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const [, authErr] = await requireAdmin()
  if (authErr) return authErr

  try {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })
    }

    const body = await req.json()
    const { name, itemCode, category, sizes } = body

    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(itemCode !== undefined && { itemCode }),
        ...(category !== undefined && { category }),
      },
    })

    if (Array.isArray(sizes)) {
      await Promise.all(
        sizes.map((s: { id: number; mrp?: number; sellingPrice?: number; barcode?: string; sizeMl?: number; bottlesPerCase?: number }) =>
          prisma.productSize.update({
            where: { id: s.id },
            data: {
              ...(s.mrp !== undefined && { mrp: s.mrp }),
              ...(s.sellingPrice !== undefined && { sellingPrice: s.sellingPrice }),
              ...(s.barcode !== undefined && { barcode: s.barcode || null }),
              ...(s.sizeMl !== undefined && { sizeMl: s.sizeMl }),
              ...(s.bottlesPerCase !== undefined && { bottlesPerCase: s.bottlesPerCase }),
            },
          })
        )
      )
    }

    return NextResponse.json({ success: true, id: product.id })
  } catch (err) {
    console.error('[products PATCH]', err)
    return NextResponse.json({ error: 'Failed to update product' }, { status: 500 })
  }
}

// DELETE /api/products/:id
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const [, authErr] = await requireAdmin()
  if (authErr) return authErr

  try {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })
    }

    await prisma.productSize.deleteMany({ where: { productId: id } })
    await prisma.product.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[products DELETE]', err)
    return NextResponse.json({ error: 'Failed to delete product' }, { status: 500 })
  }
}
