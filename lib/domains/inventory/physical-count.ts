import { CountStatus, DeductionStatus, Prisma } from "@prisma/client"

import { PrismaTransactionClient } from "@/lib/domains/inventory/stock"
import { calculateStock } from "@/lib/domains/inventory/stock"
import { todayDateString } from "@/lib/platform/dates"

export async function startCountSession(
  tx: PrismaTransactionClient,
  actorId: number,
): Promise<number> {
  const session = await tx.physicalCountSession.create({
    data: {
      sessionDate: new Date(todayDateString()),
      status: CountStatus.IN_PROGRESS,
      conductedById: actorId,
    },
  })
  return session.id
}

export type CountItemInput = {
  productSizeId: number
  countedBottles: number
}

export async function recordCountItems(
  tx: PrismaTransactionClient,
  sessionId: number,
  items: CountItemInput[],
): Promise<void> {
  for (const item of items) {
    const stock = await calculateStock(tx, item.productSizeId, {})
    const systemBottles = stock.totalBottles
    const variance = item.countedBottles - systemBottles

    const productSize = await tx.productSize.findUniqueOrThrow({
      where: { id: item.productSizeId },
      select: { sellingPrice: true },
    })

    const shortageValue = variance < 0
      ? productSize.sellingPrice.times(Math.abs(variance))
      : new Prisma.Decimal(0)

    await tx.physicalCountItem.upsert({
      where: { sessionId_productSizeId: { sessionId, productSizeId: item.productSizeId } },
      create: {
        sessionId,
        productSizeId: item.productSizeId,
        systemBottles,
        countedBottles: item.countedBottles,
        variance,
        sellingPrice: productSize.sellingPrice,
        shortageValue,
      },
      update: {
        countedBottles: item.countedBottles,
        variance,
        shortageValue,
      },
    })
  }

  await tx.physicalCountSession.update({
    where: { id: sessionId },
    data: { status: CountStatus.PENDING_APPROVAL },
  })
}

export async function approveCountSession(
  tx: PrismaTransactionClient,
  sessionId: number,
  approvedById: number,
): Promise<void> {
  const session = await tx.physicalCountSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { items: true },
  })

  if (session.status !== CountStatus.PENDING_APPROVAL) {
    throw new Error(`Session ${sessionId} is not pending approval`)
  }

  const totalShortage = session.items.reduce(
    (sum, item) => sum.plus(item.shortageValue),
    new Prisma.Decimal(0),
  )

  await tx.physicalCountSession.update({
    where: { id: sessionId },
    data: { status: CountStatus.APPROVED, approvedById, approvedAt: new Date() },
  })

  if (totalShortage.greaterThan(0)) {
    // Find active cashiers for equal split
    const cashiers = await tx.cashierSettlement.findMany({
      where: { status: "DRAFT" },
      select: { id: true, cashierId: true },
    })

    if (cashiers.length > 0) {
      const splitAmount = totalShortage.dividedBy(cashiers.length).toDecimalPlaces(2)
      for (const cashier of cashiers) {
        await tx.cashierShortageDeduction.create({
          data: {
            sessionId,
            settlementId: cashier.id,
            amount: splitAmount,
            status: DeductionStatus.PENDING,
          },
        })
      }
    }
  }
}
