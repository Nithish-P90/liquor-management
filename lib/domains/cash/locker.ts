import { LockerEventType, Prisma } from "@prisma/client"

import { PrismaTransactionClient } from "@/lib/domains/inventory/stock"

export async function getOrCreateLocker(
  tx: PrismaTransactionClient,
): Promise<{ id: number; balance: Prisma.Decimal }> {
  const existing = await tx.lockerRecord.findFirst({ orderBy: { id: "asc" } })
  if (existing) return existing
  return tx.lockerRecord.create({ data: {} })
}

export async function computeLockerBalance(
  tx: PrismaTransactionClient,
  lockerId: number,
): Promise<Prisma.Decimal> {
  const events = await tx.lockerEvent.findMany({ where: { lockerId } })
  let balance = new Prisma.Decimal(0)
  for (const e of events) {
    if (e.eventType === LockerEventType.TRANSFER_IN) {
      balance = balance.plus(e.amount)
    } else {
      balance = balance.minus(e.amount)
    }
  }
  return balance
}

export async function transferGallaToLocker(
  tx: PrismaTransactionClient,
  params: {
    gallaDayId: number
    amount: Prisma.Decimal | number
    reference?: string
    actorId?: number  // for audit trail
  },
): Promise<void> {
  const amt = new Prisma.Decimal(params.amount.toString())

  await tx.gallaEvent.create({
    data: {
      gallaDayId: params.gallaDayId,
      eventType: "TRANSFER_TO_LOCKER",
      amount: amt,
      reference: params.reference,
    },
  })

  const locker = await getOrCreateLocker(tx)
  await tx.lockerEvent.create({
    data: {
      lockerId: locker.id,
      eventType: LockerEventType.TRANSFER_IN,
      amount: amt,
      reference: params.reference,
    },
  })

  // Audit trail for transfer
  if (params.actorId) {
    await tx.auditEvent.create({
      data: {
        actorId: params.actorId,
        eventType: "TRANSFER_GALLA_TO_LOCKER",
        entity: "LockerEvent",
        entityId: locker.id,
        afterSnapshot: { gallaDayId: params.gallaDayId, amount: amt.toString(), reference: params.reference },
      },
    })
  }
}

export async function transferGallaToBank(
  tx: PrismaTransactionClient,
  params: {
    gallaDayId: number
    amount: Prisma.Decimal | number
    reference?: string
    actorId?: number  // for audit trail
  },
): Promise<void> {
  const amt = new Prisma.Decimal(params.amount.toString())

  await tx.gallaEvent.create({
    data: {
      gallaDayId: params.gallaDayId,
      eventType: "TRANSFER_TO_BANK",
      amount: amt,
      reference: params.reference,
    },
  })

  // Audit trail for transfer
  if (params.actorId) {
    await tx.auditEvent.create({
      data: {
        actorId: params.actorId,
        eventType: "TRANSFER_GALLA_TO_BANK",
        entity: "GallaDay",
        entityId: params.gallaDayId,
        afterSnapshot: { amount: amt.toString(), reference: params.reference },
      },
    })
  }
}

export async function depositLockerToBank(
  tx: PrismaTransactionClient,
  params: {
    amount: Prisma.Decimal | number
    reference?: string
    actorId?: number  // for audit trail
  },
): Promise<void> {
  const locker = await getOrCreateLocker(tx)
  const amt = new Prisma.Decimal(params.amount.toString())

  await tx.lockerEvent.create({
    data: {
      lockerId: locker.id,
      eventType: LockerEventType.DEPOSIT_TO_BANK,
      amount: amt,
      reference: params.reference,
    },
  })

  await tx.lockerRecord.update({
    where: { id: locker.id },
    data: { balance: await computeLockerBalance(tx, locker.id).then((b) => b.minus(amt)) },
  })

  // Audit trail for deposit
  if (params.actorId) {
    await tx.auditEvent.create({
      data: {
        actorId: params.actorId,
        eventType: "DEPOSIT_LOCKER_TO_BANK",
        entity: "LockerRecord",
        entityId: locker.id,
        afterSnapshot: { amount: amt.toString(), reference: params.reference },
      },
    })
  }
}
