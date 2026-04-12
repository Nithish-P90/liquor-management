import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getCurrentStock } from '@/lib/reconciliation'
import { splitStock } from '@/lib/stock-utils'

export const dynamic = 'force-dynamic'

export async function GET() {
  const productSizes = await prisma.productSize.findMany({
    include: { product: true },
    orderBy: [{ product: { category: 'asc' } }, { product: { name: 'asc' } }, { sizeMl: 'desc' }],
  })

  const stock = await Promise.all(
    productSizes.map(async ps => {
      const currentStock = await getCurrentStock(ps.id)
      return {
        id: ps.id,
        productId: ps.productId,
        productName: ps.product.name,
        category: ps.product.category,
        sizeMl: ps.sizeMl,
        bottlesPerCase: ps.bottlesPerCase,
        sellingPrice: ps.sellingPrice,
        mrp: ps.mrp,
        barcode: ps.barcode,
        currentStock,
        ...splitStock(currentStock, ps.bottlesPerCase),
      }
    })
  )

  return NextResponse.json(stock)
}
