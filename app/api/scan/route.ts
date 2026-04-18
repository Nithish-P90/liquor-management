import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getCurrentStock } from '@/lib/reconciliation'
import { requireSession } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const [, err] = await requireSession()
  if (err) return err
  const { searchParams } = new URL(req.url)
  const barcode = searchParams.get('barcode')
  const itemCode = searchParams.get('itemCode')

  if (!barcode && !itemCode) {
    return NextResponse.json({ error: 'barcode or itemCode required' }, { status: 400 })
  }

  const productSize = await prisma.productSize.findFirst({
    where: barcode ? { barcode } : { product: { itemCode: itemCode! } },
    include: { product: true },
  })

  if (!productSize) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  const currentStock = await getCurrentStock(productSize.id)

  return NextResponse.json({
    id: productSize.id,
    productId: productSize.productId,
    productName: productSize.product.name,
    category: productSize.product.category,
    sizeMl: productSize.sizeMl,
    mrp: productSize.mrp,
    sellingPrice: productSize.sellingPrice,
    currentStock,
  })
}
