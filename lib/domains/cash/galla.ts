import { GallaEventType, Prisma } from "@prisma/client"

import { PrismaTransactionClient } from "@/lib/stock"

export async function getOrCreateGallaDay(
  tx: PrismaTransactionClient,
  businessDate: Date,
): Promise<{ id: number; openingBalance: Prisma.Decimal; isClosed: boolean }> {
  const existing = await tx.gallaDay.findUnique({ where: { businessDate } })
  if (existing) return existing

  // Opening balance = previous day closing
  const prev = await tx.gallaDay.findFirst({
    where: { businessDate: { lt: businessDate } },
    orderBy: { businessDate: "desc" },
    select: { closingBalance: true },
  })

  return tx.gallaDay.create({
    data: {
      businessDate,
      openingBalance: prev?.closingBalance ?? new Prisma.Decimal(0),
    },
  })
}

export async function emitGallaEvent(
  tx: PrismaTransactionClient,
  params: {
    businessDate: Date
    eventType: GallaEventType
    amount: Prisma.Decimal | number
    reference?: string
    billId?: number
    expenditureId?: number
  },
): Promise<void> {
  const day = await getOrCreateGallaDay(tx, params.businessDate)
  if (day.isClosed) return

  await tx.gallaEvent.create({
    data: {
      gallaDayId: day.id,
      eventType: params.eventType,
      amount: new Prisma.Decimal(params.amount.toString()),
      reference: params.reference,
      billId: params.billId,
      expenditureId: params.expenditureId,
    },
  })
}

export async function computeGallaBalance(
  tx: PrismaTransactionClient,
  gallaDayId: number,
): Promise<Prisma.Decimal> {
  const day = await tx.gallaDay.findUniqueOrThrow({
    where: { id: gallaDayId },
    include: { events: true },
  })

  let balance = day.openingBalance

  for (const event of day.events) {
    switch (event.eventType) {
      case GallaEventType.SALE_CASH:
      case GallaEventType.OPENING_BALANCE:
        balance = balance.plus(event.amount)
        break
      case GallaEventType.REFUND_CASH:
      case GallaEventType.EXPENSE:
      case GallaEventType.TRANSFER_TO_LOCKER:
        balance = balance.minus(event.amount)
        break
      default:
        break
    }
  }

  return balance
}

export async function closeGallaDay(
  tx: PrismaTransactionClient,
  gallaDayId: number,
  countedAmount: Prisma.Decimal | number,
  closedById: number,
): Promise<{ variance: Prisma.Decimal }> {
  const computed = await computeGallaBalance(tx, gallaDayId)
  const counted = new Prisma.Decimal(countedAmount.toString())
  const variance = counted.minus(computed)

  await tx.gallaDay.update({
    where: { id: gallaDayId },
    data: {
      closingBalance: computed,
      countedAmount: counted,
      variance,
      isClosed: true,
      closedAt: new Date(),
      closedById,
    },
  })

  return { variance }
}
