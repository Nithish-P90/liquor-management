import { ClearanceStatus, Prisma } from "@prisma/client"

import { PrismaTransactionClient } from "@/lib/domains/inventory/stock"

export type RateSegment = {
  rate: Prisma.Decimal
  quantity: number
  clearanceBatchId?: number
}

/**
 * Returns rate segments covering `qtyNeeded` bottles for the given variant.
 * Clearance batches are consumed first (FIFO), remainder uses sellingPrice.
 * Does NOT write anything — caller (commitBill) does the soldQuantity update.
 */
export async function resolveRate(
  tx: PrismaTransactionClient,
  productSizeId: number,
  qtyNeeded: number,
): Promise<RateSegment[]> {
  const [activeBatches, productSize] = await Promise.all([
    tx.clearanceBatch.findMany({
      where: { productSizeId, status: ClearanceStatus.ACTIVE },
      orderBy: { createdAt: "asc" },
    }),
    tx.productSize.findUniqueOrThrow({
      where: { id: productSizeId },
      select: { sellingPrice: true },
    }),
  ])

  const segments: RateSegment[] = []
  let remaining = qtyNeeded

  for (const batch of activeBatches) {
    if (remaining <= 0) break
    const available = batch.totalQuantity - batch.soldQuantity
    if (available <= 0) continue
    const take = Math.min(remaining, available)
    segments.push({ rate: batch.clearanceRate, quantity: take, clearanceBatchId: batch.id })
    remaining -= take
  }

  if (remaining > 0) {
    segments.push({ rate: productSize.sellingPrice, quantity: remaining })
  }

  return segments
}

/**
 * Records consumption of clearance quantities after commitBill finalizes segments.
 * Marks batch EXHAUSTED when soldQuantity reaches totalQuantity.
 */
export async function applyClearanceSegments(
  tx: PrismaTransactionClient,
  segments: RateSegment[],
): Promise<void> {
  for (const seg of segments) {
    if (!seg.clearanceBatchId) continue
    const batch = await tx.clearanceBatch.update({
      where: { id: seg.clearanceBatchId },
      data: { soldQuantity: { increment: seg.quantity } },
    })
    if (batch.soldQuantity >= batch.totalQuantity) {
      await tx.clearanceBatch.update({
        where: { id: seg.clearanceBatchId },
        data: { status: ClearanceStatus.EXHAUSTED, exhaustedAt: new Date() },
      })
    }
  }
}

/**
 * Reverses clearance consumption when a bill is voided.
 */
export async function reverseClearanceSegments(
  tx: PrismaTransactionClient,
  segments: RateSegment[],
): Promise<void> {
  for (const seg of segments) {
    if (!seg.clearanceBatchId) continue
    const batch = await tx.clearanceBatch.update({
      where: { id: seg.clearanceBatchId },
      data: {
        soldQuantity: { decrement: seg.quantity },
        status: ClearanceStatus.ACTIVE,
        exhaustedAt: null,
      },
    })
    if (batch.soldQuantity < 0) {
      await tx.clearanceBatch.update({
        where: { id: seg.clearanceBatchId },
        data: { soldQuantity: 0 },
      })
    }
  }
}

export async function createClearanceBatch(
  tx: PrismaTransactionClient,
  params: {
    productSizeId: number
    clearanceRate: Prisma.Decimal | number
    totalQuantity: number
    reason?: string
    createdById: number
  },
): Promise<number> {
  const productSize = await tx.productSize.findUniqueOrThrow({
    where: { id: params.productSizeId },
    select: { sellingPrice: true },
  })

  const batch = await tx.clearanceBatch.create({
    data: {
      productSizeId: params.productSizeId,
      originalRate: productSize.sellingPrice,
      clearanceRate: params.clearanceRate,
      totalQuantity: params.totalQuantity,
      reason: params.reason,
      createdById: params.createdById,
    },
  })
  return batch.id
}

export async function cancelClearanceBatch(
  tx: PrismaTransactionClient,
  batchId: number,
  cancelledById: number,
): Promise<void> {
  await tx.clearanceBatch.update({
    where: { id: batchId, status: ClearanceStatus.ACTIVE },
    data: {
      status: ClearanceStatus.CANCELLED,
      cancelledById,
      cancelledAt: new Date(),
    },
  })
}
