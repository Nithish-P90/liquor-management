import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { indentId, items, notes } = body
  // items: [{ indentItemId, productSizeId, casesReceived, bottlesReceived }]

  const staffId = parseInt(((session.user as { id?: string } | undefined)?.id) ?? '0')
  const today = toUtcNoonDate(new Date())

  const receipt = await prisma.$transaction(async tx => {
    const createdReceipt = await tx.receipt.create({
      data: {
        indentId,
        receivedDate: today,
        staffId,
        notes: notes || null,
        items: {
          create: items.map((item: any) => ({
            productSizeId: item.productSizeId,
            casesReceived: item.casesReceived,
            bottlesReceived: item.bottlesReceived,
            totalBottles: item.casesReceived * (item.bottlesPerCase ?? 12) + item.bottlesReceived,
          })),
        },
      },
      include: { items: true },
    })

    for (const item of items) {
      // Update received quantities
      const updatedItem = await tx.indentItem.update({
        where: { id: item.indentItemId },
        data: {
          receivedCases: { increment: item.casesReceived },
          receivedBottles: { increment: item.bottlesReceived },
        },
      })

      // Auto-update selling price = ceil(ratePerCase / bottlesPerCase * 1.25)
      if (updatedItem.ratePerCase && item.bottlesPerCase) {
        const costPerBottle = Number(updatedItem.ratePerCase) / item.bottlesPerCase
        const sellingPrice = Math.ceil(costPerBottle * 1.25)
        await tx.productSize.update({
          where: { id: item.productSizeId },
          data: { sellingPrice },
        })
      }
    }

    const indent = await tx.indent.findUnique({
      where: { id: indentId },
      include: { items: { include: { productSize: true } } },
    })

    if (indent) {
      const allReceived = indent.items.every(i => {
        const bottlesPerCase = i.productSize.bottlesPerCase || 1
        const receivedTotal = (i.receivedCases * bottlesPerCase) + i.receivedBottles
        const requiredTotal = (i.cnfCases * bottlesPerCase) + i.cnfBottles
        return receivedTotal >= requiredTotal
      })
      await tx.indent.update({
        where: { id: indentId },
        data: { status: allReceived ? 'FULLY_RECEIVED' : 'PARTIAL' },
      })
    }

    return createdReceipt
  })

  return NextResponse.json(receipt)
}
