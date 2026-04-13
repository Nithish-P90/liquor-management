import prisma from './prisma'
import { toUtcNoonDate } from './date-utils'

type Severity = 'LOW' | 'HIGH' | 'CRITICAL' | 'OK';

const LOW_THRESHOLD = 2   // variance up to 2 bottles = LOW
const HIGH_THRESHOLD = 3  // variance > 3 bottles = HIGH

export async function runReconciliation(date: Date, sessionId: number) {
  const dateOnly = toUtcNoonDate(date)

  // Get all product sizes that have any activity
  const productSizes = await prisma.productSize.findMany({
    include: { product: true },
  })

  const results = []

  for (const ps of productSizes) {
    // Get opening stock for this session
    const openingEntry = await prisma.stockEntry.findUnique({
      where: {
        sessionId_productSizeId_entryType: {
          sessionId,
          productSizeId: ps.id,
          entryType: 'OPENING',
        },
      },
    })

    const openingBottles = openingEntry?.totalBottles ?? 0

    // Get all receipts for this date
    const receiptItems = await prisma.receiptItem.findMany({
      where: {
        productSizeId: ps.id,
        receipt: { receivedDate: { lte: dateOnly } },
      },
    })
    const receiptBottles = receiptItems.reduce((s: number, r: any) => s + r.totalBottles, 0)

    // Get sales for this date
    const salesAgg = await prisma.sale.aggregate({
      where: { productSizeId: ps.id, saleDate: dateOnly },
      _sum: { quantityBottles: true },
    })
    const soldBottles = salesAgg._sum.quantityBottles ?? 0

    // Get approved adjustments for this date
    const adjAgg = await prisma.stockAdjustment.aggregate({
      where: {
        productSizeId: ps.id,
        adjustmentDate: dateOnly,
        approved: true,
      },
      _sum: { quantityBottles: true },
    })
    const adjustmentBottles = adjAgg._sum.quantityBottles ?? 0

    const expectedClosing = openingBottles + receiptBottles + adjustmentBottles - soldBottles

    // Get physical closing count
    const closingEntry = await prisma.stockEntry.findUnique({
      where: {
        sessionId_productSizeId_entryType: {
          sessionId,
          productSizeId: ps.id,
          entryType: 'CLOSING',
        },
      },
    })

    // Only record variance if closing stock was entered
    if (!closingEntry) continue

    const actualBottles = closingEntry.totalBottles
    const variance = actualBottles - expectedClosing

    let severity: Severity = 'OK'
    if (Math.abs(variance) > HIGH_THRESHOLD) severity = 'HIGH'
    else if (Math.abs(variance) > LOW_THRESHOLD) severity = 'LOW'

    // Upsert variance record
    await prisma.varianceRecord.upsert({
      where: {
        recordDate_productSizeId: {
          recordDate: dateOnly,
          productSizeId: ps.id,
        },
      },
      create: {
        recordDate: dateOnly,
        productSizeId: ps.id,
        expectedBottles: expectedClosing,
        actualBottles,
        variance,
        severity,
      },
      update: {
        expectedBottles: expectedClosing,
        actualBottles,
        variance,
        severity,
        resolved: false,
      },
    })

    if (severity !== 'OK') {
      results.push({
        product: ps.product.name,
        sizeMl: ps.sizeMl,
        expected: expectedClosing,
        actual: actualBottles,
        variance,
        severity,
      })
    }
  }

  return results
}

export async function getCurrentStock(productSizeId: number, targetSessionId?: number): Promise<number> {
  // Find the target or most recent session
  const latestSession = targetSessionId 
    ? await prisma.inventorySession.findUnique({ where: { id: targetSessionId } })
    : await prisma.inventorySession.findFirst({ orderBy: { periodStart: 'desc' } })

  const opening = latestSession
    ? await prisma.stockEntry.findUnique({
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
    const endBoundary = latestSession!.periodEnd < new Date() ? latestSession!.periodEnd : new Date('2099-01-01');
    const receiptItems = await prisma.receiptItem.findMany({
      where: {
        productSizeId,
        receipt: { receivedDate: { gte: latestSession!.periodStart, lte: endBoundary } },
      },
    })
    const receiptBottles = receiptItems.reduce((s: number, r: any) => s + r.totalBottles, 0)

    const salesAgg = await prisma.sale.aggregate({
      where: {
        productSizeId,
        saleDate: { gte: latestSession!.periodStart },
      },
      _sum: { quantityBottles: true },
    })
    const soldBottles = salesAgg._sum.quantityBottles ?? 0

    const adjAgg = await prisma.stockAdjustment.aggregate({
      where: {
        productSizeId,
        approved: true,
        adjustmentDate: { gte: latestSession!.periodStart },
      },
      _sum: { quantityBottles: true },
    })
    const adjustmentBottles = adjAgg._sum.quantityBottles ?? 0

    return (opening.totalBottles ?? 0) + receiptBottles + adjustmentBottles - soldBottles
  }

  const [receiptAgg, salesAgg, adjAgg] = await Promise.all([
    prisma.receiptItem.aggregate({
      where: { productSizeId },
      _sum: { totalBottles: true },
    }),
    prisma.sale.aggregate({
      where: { productSizeId },
      _sum: { quantityBottles: true },
    }),
    prisma.stockAdjustment.aggregate({
      where: { productSizeId, approved: true },
      _sum: { quantityBottles: true },
    }),
  ])

  const receiptBottles = receiptAgg._sum.totalBottles ?? 0
  const soldBottles = salesAgg._sum.quantityBottles ?? 0
  const adjustmentBottles = adjAgg._sum.quantityBottles ?? 0

  return receiptBottles + adjustmentBottles - soldBottles
}
