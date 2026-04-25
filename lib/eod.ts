import { BillStatus, GallaEventType, PaymentMode, Prisma } from "@prisma/client"

import { parseDateParam, todayDateString } from "@/lib/dates"
import { getOrCreateGallaDay } from "@/lib/galla"
import { prisma } from "@/lib/prisma"
import { calculateStock } from "@/lib/stock"
import { DateString } from "@/lib/types"

export async function runEndOfDay(businessDate: DateString = todayDateString()): Promise<{
  forcedTabs: number
  snapshotCreated: boolean
}> {
  const dateObj = parseDateParam(businessDate)

  return prisma.$transaction(async (tx) => {
    // 1. Force-settle all TAB_OPEN bills for this business date
    const openTabs = await tx.bill.findMany({
      where: { status: BillStatus.TAB_OPEN, businessDate: dateObj },
      select: { id: true, netCollectible: true },
    })

    for (const tab of openTabs) {
      await tx.bill.update({
        where: { id: tab.id },
        data: { status: BillStatus.TAB_FORCE_SETTLED },
      })

      await tx.notification.create({
        data: {
          type: "TAB_FORCE_SETTLED",
          title: "Tab force-settled at end of day",
          body: `Bill #${tab.id} (₹${tab.netCollectible}) was open at EOD and has been force-settled.`,
          severity: "WARN",
          refEntity: "Bill",
          refEntityId: tab.id,
        },
      })
    }

    // 2. Build stock snapshot for all active product sizes
    const sizes = await tx.productSize.findMany({ select: { id: true } })
    const stockMap: Record<number, number> = {}
    for (const size of sizes) {
      const result = await calculateStock(tx, size.id, { upToDate: businessDate })
      stockMap[size.id] = result.totalBottles
    }

    // 3. Compute payment totals for the day
    const payments = await tx.paymentAllocation.groupBy({
      by: ["mode"],
      _sum: { amount: true },
      where: {
        bill: {
          businessDate: dateObj,
          status: { in: [BillStatus.COMMITTED, BillStatus.TAB_FORCE_SETTLED] },
        },
      },
    })

    function getTotal(mode: PaymentMode): Prisma.Decimal {
      const row = payments.find((p) => p.mode === mode)
      return row?._sum.amount ?? new Prisma.Decimal(0)
    }

    const cashSales = getTotal(PaymentMode.CASH)
    const cardSales = getTotal(PaymentMode.CARD)
    const upiSales = getTotal(PaymentMode.UPI)
    const creditSales = getTotal(PaymentMode.CREDIT)

    const expenses = await tx.expenditure.aggregate({
      _sum: { amount: true },
      where: { expDate: dateObj },
    })
    const totalExpenses = expenses._sum.amount ?? new Prisma.Decimal(0)

    // 4. Write DailySnapshot (upsert — EOD can run once)
    const gallaDay = await getOrCreateGallaDay(tx, dateObj)

    const existing = await tx.dailySnapshot.findUnique({ where: { gallaDayId: gallaDay.id } })
    let snapshotCreated = false

    if (!existing) {
      await tx.dailySnapshot.create({
        data: {
          gallaDayId: gallaDay.id,
          stockMap,
          cashSales,
          cardSales,
          upiSales,
          creditSales,
          totalExpenses,
        },
      })
      snapshotCreated = true
    }

    // 5. Payment reconciliation row
    await tx.paymentReconciliation.upsert({
      where: { businessDate: dateObj },
      create: {
        businessDate: dateObj,
        systemCash: cashSales,
        systemCard: cardSales,
        systemUpi: upiSales,
      },
      update: {
        systemCash: cashSales,
        systemCard: cardSales,
        systemUpi: upiSales,
      },
    })

    // 6. Emit cash sales event to galla
    if (cashSales.greaterThan(0) && !gallaDay.isClosed) {
      await tx.gallaEvent.create({
        data: {
          gallaDayId: gallaDay.id,
          eventType: GallaEventType.SALE_CASH,
          amount: cashSales,
          reference: `EOD ${businessDate}`,
        },
      })
    }

    return { forcedTabs: openTabs.length, snapshotCreated }
  })
}
