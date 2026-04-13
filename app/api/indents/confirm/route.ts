import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'

export const dynamic = 'force-dynamic'

// Confirm parsed indent → save to database AND immediately receive stock at CNF quantities
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const staffId = parseInt(((session.user as { id?: string } | undefined)?.id) ?? '0')
  const body = await req.json()
  const { header, items, pdfPath } = body

  const today = toUtcNoonDate(new Date())

  const indent = await prisma.$transaction(async tx => {
    // 1. Create indent with line items
    const created = await tx.indent.create({
      data: {
        indentNumber: header.indentNumber,
        invoiceNumber: header.invoiceNumber,
        retailerId: header.retailerId,
        retailerName: header.retailerName,
        indentDate: new Date(header.indentDate.replace(/\//g, '-').split(',')[0] ?? new Date()),
        pdfPath,
        status: 'FULLY_RECEIVED',
        items: {
          create: items
            .filter((item: any) => item.productId && item.productSizeId)
            .map((item: any) => ({
              productId: item.productId,
              productSizeId: item.productSizeId,
              ratePerCase: item.ratePerCase,
              isRationed: item.isRationed ?? false,
              indentCases: item.indentCases,
              indentBottles: item.indentBottles,
              indentAmount: item.indentAmount,
              cnfCases: item.cnfCases,
              cnfBottles: item.cnfBottles,
              cnfAmount: item.cnfAmount,
              // Mark as fully received at CNF quantities
              receivedCases: item.cnfCases,
              receivedBottles: item.cnfBottles,
            })),
        },
      },
      include: { items: { include: { product: true, productSize: true } } },
    })

    // 2. Auto-create receipt at CNF quantities so inventory updates immediately
    const receiptItems = created.items.filter(i => i.productSizeId && (i.cnfCases > 0 || i.cnfBottles > 0))
    if (receiptItems.length > 0) {
      await tx.receipt.create({
        data: {
          indentId: created.id,
          receivedDate: today,
          staffId,
          notes: `Auto-received on indent confirmation`,
          items: {
            create: receiptItems.map(item => {
              const bottlesPerCase = item.productSize?.bottlesPerCase ?? 12
              const totalBottles = item.cnfCases * bottlesPerCase + item.cnfBottles
              return {
                productSizeId: item.productSizeId,
                casesReceived: item.cnfCases,
                bottlesReceived: item.cnfBottles,
                totalBottles,
              }
            }),
          },
        },
      })

      // 3. Auto-update selling price = ceil(ratePerCase / bottlesPerCase * 1.25)
      //    If new price is HIGHER → update silently
      //    If new price is LOWER  → keep old price, create notification
      for (const item of receiptItems) {
        if (item.ratePerCase && item.productSize?.bottlesPerCase) {
          const costPerBottle = Number(item.ratePerCase) / item.productSize.bottlesPerCase
          const newSellingPrice = Math.ceil(costPerBottle * 1.25)
          const oldSellingPrice = Number(item.productSize.sellingPrice)

          if (newSellingPrice > oldSellingPrice) {
            // Price went up — update immediately
            await tx.productSize.update({
              where: { id: item.productSizeId },
              data: { sellingPrice: newSellingPrice },
            })
          } else if (newSellingPrice < oldSellingPrice) {
            // Price went down — notify, don't auto-update (existing stock was bought at higher cost)
            await tx.notification.create({
              data: {
                type: 'PRICE_DECREASE',
                title: `KSBCL price dropped: ${item.product?.name ?? 'Unknown'} ${item.productSize.sizeMl}ml`,
                body: `New purchase cost suggests selling price of ₹${newSellingPrice}, but current price is ₹${oldSellingPrice}. Update manually once existing stock is sold.`,
              },
            })
          }
          // If equal, no action needed
        }
      }
    }

    return created
  })

  return NextResponse.json(indent)
}
