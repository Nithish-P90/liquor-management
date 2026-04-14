import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { saleId } = await req.json()
  if (!saleId) return NextResponse.json({ error: 'saleId required' }, { status: 400 })

  const staffId = parseInt((session.user as { id?: string } | undefined)?.id ?? '0')

  const sale = await prisma.sale.findUnique({ where: { id: saleId } })
  if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })

  const today = toUtcNoonDate(new Date())

  await prisma.$transaction(async tx => {
    // Delete the original sale
    await tx.sale.delete({ where: { id: saleId } })

    // Create a RETURN stock adjustment to add bottles back
    await tx.stockAdjustment.create({
      data: {
        adjustmentDate: today,
        productSizeId: sale.productSizeId,
        adjustmentType: 'RETURN',
        quantityBottles: sale.quantityBottles,
        reason: `Void of Sale #${saleId}`,
        createdById: staffId,
        approvedById: staffId,
        approved: true,
      },
    })
  })

  return NextResponse.json({ success: true })
}
