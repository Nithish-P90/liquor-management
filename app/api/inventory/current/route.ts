import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { getCurrentStock } from '@/lib/reconciliation'
import { splitStock } from '@/lib/stock-utils'
import { authOptions } from '@/lib/auth'
import { toUtcNoonDate } from '@/lib/date-utils'

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

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { id?: string; role?: string } | undefined

  if (!session || user?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Only admins can edit stock' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const productSizeId = Number(body?.productSizeId)
  const newStock = Number(body?.newStock)
  const reasonInput = typeof body?.reason === 'string' ? body.reason.trim() : ''

  if (!Number.isInteger(productSizeId) || productSizeId <= 0) {
    return NextResponse.json({ error: 'Invalid productSizeId' }, { status: 400 })
  }
  if (!Number.isInteger(newStock) || newStock < 0) {
    return NextResponse.json({ error: 'newStock must be a non-negative integer' }, { status: 400 })
  }

  const ps = await prisma.productSize.findUnique({ where: { id: productSizeId }, include: { product: true } })
  if (!ps) {
    return NextResponse.json({ error: 'Product size not found' }, { status: 404 })
  }

  const currentStock = await getCurrentStock(productSizeId)
  const delta = newStock - currentStock
  if (delta === 0) {
    return NextResponse.json({
      success: true,
      message: 'No stock change required',
      productSizeId,
      currentStock,
      updatedStock: currentStock,
    })
  }

  let createdById = Number.parseInt(user?.id ?? '', 10)
  if (!Number.isInteger(createdById) || createdById <= 0) {
    const fallbackAdmin = await prisma.staff.findFirst({ where: { role: 'ADMIN', active: true }, select: { id: true } })
    if (!fallbackAdmin) {
      return NextResponse.json({ error: 'No active admin staff account available for audit trail' }, { status: 400 })
    }
    createdById = fallbackAdmin.id
  }

  const reason = reasonInput || `Manual stock correction by admin (${currentStock} -> ${newStock})`
  const adjustmentDate = toUtcNoonDate(new Date())

  await prisma.stockAdjustment.create({
    data: {
      adjustmentDate,
      productSizeId,
      adjustmentType: 'CORRECTION',
      quantityBottles: delta,
      reason,
      createdById,
      approvedById: createdById,
      approved: true,
    },
  })

  return NextResponse.json({
    success: true,
    productSizeId,
    currentStock,
    updatedStock: newStock,
    delta,
    productName: ps.product.name,
    sizeMl: ps.sizeMl,
  })
}
