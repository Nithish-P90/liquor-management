/**
 * Stock utility functions for normalizing stock entries and converting
 * between total-bottles ↔ cases+bottles representations.
 *
 * Used by the inventory opening/closing/current API routes.
 */

import { PrismaClient } from '@prisma/client'

type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

export async function getAvailableStock(tx: TxClient, productSizeId: number): Promise<number> {
  const latestSession = await tx.inventorySession.findFirst({ orderBy: { periodStart: 'desc' } })

  const opening = latestSession
    ? await tx.stockEntry.findUnique({
        where: {
          sessionId_productSizeId_entryType: {
            sessionId: latestSession.id,
            productSizeId,
            entryType: 'OPENING',
          },
        },
      })
    : null

  if (opening) {
    const [receiptAgg, salesAgg, adjAgg, pendingAgg] = await Promise.all([
      tx.receiptItem.aggregate({
        where: {
          productSizeId,
          receipt: { receivedDate: { gte: latestSession!.periodStart } },
        },
        _sum: { totalBottles: true },
      }),
      tx.sale.aggregate({
        where: {
          productSizeId,
          saleDate: { gte: latestSession!.periodStart },
        },
        _sum: { quantityBottles: true },
      }),
      tx.stockAdjustment.aggregate({
        where: {
          productSizeId,
          approved: true,
          adjustmentDate: { gte: latestSession!.periodStart },
        },
        _sum: { quantityBottles: true },
      }),
      tx.pendingBillItem.aggregate({
        where: {
          productSizeId,
          bill: {
            settled: false,
            saleDate: { gte: latestSession!.periodStart },
          },
        },
        _sum: { quantityBottles: true },
      }),
    ])

    return (
      (opening.totalBottles ?? 0) +
      (receiptAgg._sum.totalBottles ?? 0) +
      (adjAgg._sum.quantityBottles ?? 0) -
      (salesAgg._sum.quantityBottles ?? 0) -
      (pendingAgg._sum.quantityBottles ?? 0)
    )
  }

  const [receiptAgg, salesAgg, adjAgg, pendingAgg] = await Promise.all([
    tx.receiptItem.aggregate({
      where: { productSizeId },
      _sum: { totalBottles: true },
    }),
    tx.sale.aggregate({
      where: { productSizeId },
      _sum: { quantityBottles: true },
    }),
    tx.stockAdjustment.aggregate({
      where: { productSizeId, approved: true },
      _sum: { quantityBottles: true },
    }),
    tx.pendingBillItem.aggregate({
      where: {
        productSizeId,
        bill: { settled: false },
      },
      _sum: { quantityBottles: true },
    }),
  ])

  return (
    (receiptAgg._sum.totalBottles ?? 0) +
    (adjAgg._sum.quantityBottles ?? 0) -
    (salesAgg._sum.quantityBottles ?? 0) -
    (pendingAgg._sum.quantityBottles ?? 0)
  )
}

/**
 * Normalize a stock entry: overflow extra loose bottles into cases.
 *
 * Example: 2 cases + 15 bottles with bottlesPerCase=12
 *  → 3 cases + 3 bottles → 39 totalBottles
 */
export function normalizeStockEntry(
  cases: number,
  bottles: number,
  bottlesPerCase: number
): { cases: number; bottles: number; totalBottles: number } {
  const totalBottles = cases * bottlesPerCase + bottles
  const normalizedCases = Math.floor(totalBottles / bottlesPerCase)
  const normalizedBottles = totalBottles % bottlesPerCase

  return {
    cases: normalizedCases,
    bottles: normalizedBottles,
    totalBottles,
  }
}

/**
 * Split a total-bottle count into cases and loose bottles.
 *
 * Used by the /api/inventory/current route to display stock in
 * a human-friendly "X cases, Y bottles" format.
 */
export function splitStock(
  totalBottles: number,
  bottlesPerCase: number
): { cases: number; bottles: number } {
  return {
    cases: Math.floor(totalBottles / bottlesPerCase),
    bottles: totalBottles % bottlesPerCase,
  }
}
