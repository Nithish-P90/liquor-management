import { prisma } from "@/lib/platform/prisma"
import { REVENUE_BILL_STATUSES } from "./bill"

export type ThirdPartyPayoutSummary = {
  periodStart: string
  periodEnd: string
  totalSales: number
  bills: Array<{ billId: number; billNumber: string; date: string; amount: number }>
  itemBreakdown: Array<{ miscItemId: number; name: string; qty: number; amount: number }>
}

/**
 * Computes the payout owed to the third-party supplier for a given date range.
 * Sums only BillLine rows where isThirdPartySnapshot = true on committed bills.
 */
export async function thirdPartyPayoutSummary(opts: {
  from: Date
  to: Date
}): Promise<ThirdPartyPayoutSummary> {
  const lines = await prisma.billLine.findMany({
    where: {
      isThirdPartySnapshot: true,
      isVoidedLine: false,
      bill: {
        status: { in: REVENUE_BILL_STATUSES },
        businessDate: { gte: opts.from, lte: opts.to },
      },
    },
    select: {
      miscItemId: true,
      miscItem: { select: { name: true } },
      quantity: true,
      lineTotal: true,
      bill: {
        select: {
          id: true,
          billNumber: true,
          businessDate: true,
          thirdPartyTotal: true,
        },
      },
    },
    orderBy: { bill: { businessDate: "asc" } },
  })

  // Aggregate per-bill totals
  const billMap = new Map<number, { billId: number; billNumber: string; date: string; amount: number }>()
  for (const l of lines) {
    const b = l.bill
    if (!billMap.has(b.id)) {
      billMap.set(b.id, {
        billId: b.id,
        billNumber: b.billNumber,
        date: b.businessDate.toISOString().slice(0, 10),
        amount: 0,
      })
    }
    billMap.get(b.id)!.amount += Number(l.lineTotal)
  }

  // Aggregate per-item breakdown
  const itemMap = new Map<number, { miscItemId: number; name: string; qty: number; amount: number }>()
  for (const l of lines) {
    if (l.miscItemId == null) continue
    const existing = itemMap.get(l.miscItemId)
    if (existing) {
      existing.qty += l.quantity
      existing.amount += Number(l.lineTotal)
    } else {
      itemMap.set(l.miscItemId, {
        miscItemId: l.miscItemId,
        name: l.miscItem?.name ?? "Unknown",
        qty: l.quantity,
        amount: Number(l.lineTotal),
      })
    }
  }

  const totalSales = Array.from(billMap.values()).reduce((s, b) => s + b.amount, 0)

  return {
    periodStart: opts.from.toISOString().slice(0, 10),
    periodEnd: opts.to.toISOString().slice(0, 10),
    totalSales,
    bills: Array.from(billMap.values()),
    itemBreakdown: Array.from(itemMap.values()).sort((a, b) => b.amount - a.amount),
  }
}
