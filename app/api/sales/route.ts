import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma, PrismaClient } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'
import { getAvailableStock } from '@/lib/stock-utils'

export const dynamic = 'force-dynamic'

type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dateStr = searchParams.get('date')
  const staffId = searchParams.get('staffId')
  const limit = parseInt(searchParams.get('limit') ?? '50')

  const where: any = {}
  if (dateStr) where.saleDate = toUtcNoonDate(new Date(dateStr + 'T12:00:00'))
  if (staffId) where.staffId = parseInt(staffId)

  const sales = await prisma.sale.findMany({
    where,
    include: {
      productSize: { include: { product: true } },
      staff: { select: { id: true, name: true } },
    },
    orderBy: { saleTime: 'desc' },
    take: limit,
  })
  return NextResponse.json(sales)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    productSizeId, quantityBottles, paymentMode, scanMethod,
    customerName, isManualOverride, overrideReason, staffId,
    cashAmount, cardAmount, upiAmount,
    saleTime, billId,
  } = body

  const requestedQuantity = Number(quantityBottles)
  if (!Number.isInteger(requestedQuantity) || requestedQuantity <= 0) {
    return NextResponse.json({ error: 'quantityBottles must be a positive integer' }, { status: 400 })
  }

  const productSize = await prisma.productSize.findUnique({
    where: { id: productSizeId },
    include: { product: { select: { category: true } } },
  })
  if (!productSize) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const now = saleTime ? new Date(saleTime) : new Date()
  if (Number.isNaN(now.getTime())) {
    return NextResponse.json({ error: 'Invalid saleTime' }, { status: 400 })
  }
  const saleDate = toUtcNoonDate(now)

  try {
    const sale = await prisma.$transaction(async tx => {
      if (productSize.product.category !== 'MISCELLANEOUS') {
        const availableStock = await getAvailableStock(tx, productSizeId)
        if (requestedQuantity > availableStock) {
          throw new Error(`Only ${availableStock} bottles are available for this item`)
        }
      }

      return tx.sale.create({
        data: {
          saleDate,
          saleTime: now,
          staffId: staffId ?? parseInt(((session.user as { id?: string } | undefined)?.id) ?? '0'),
          productSizeId,
          quantityBottles: requestedQuantity,
          sellingPrice: productSize.sellingPrice,
          totalAmount: Number(productSize.sellingPrice) * requestedQuantity,
          paymentMode,
          cashAmount: cashAmount != null ? Number(cashAmount) : null,
          cardAmount: cardAmount != null ? Number(cardAmount) : null,
          upiAmount: upiAmount != null ? Number(upiAmount) : null,
          scanMethod: scanMethod ?? 'MANUAL',
          customerName: customerName || null,
          isManualOverride: isManualOverride ?? false,
          overrideReason: overrideReason || null,
          billId: billId || null,
        },
        include: {
          productSize: { include: { product: true } },
          staff: { select: { id: true, name: true } },
        },
      })
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })

    return NextResponse.json(sale)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record sale'
    if (message.startsWith('Only ')) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
