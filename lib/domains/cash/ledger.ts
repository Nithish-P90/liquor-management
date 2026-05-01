import { BillStatus, Prisma } from "@prisma/client"

import { parseDateParam } from "@/lib/dates"
import { prisma } from "@/lib/prisma"
import { DateString } from "@/lib/types"

export type DateRange = { from: DateString; to: DateString }

function dateRange(r: DateRange): { gte: Date; lte: Date } {
  return { gte: parseDateParam(r.from), lte: parseDateParam(r.to) }
}

export async function getSalesSummary(range: DateRange) {
  const dr = dateRange(range)

  const [bills, payments] = await Promise.all([
    prisma.bill.aggregate({
      _count: { id: true },
      _sum: { grossTotal: true, discountTotal: true, netCollectible: true },
      where: {
        businessDate: dr,
        status: { in: [BillStatus.COMMITTED, BillStatus.TAB_FORCE_SETTLED] },
      },
    }),
    prisma.paymentAllocation.groupBy({
      by: ["mode"],
      _sum: { amount: true },
      where: {
        bill: {
          businessDate: dr,
          status: { in: [BillStatus.COMMITTED, BillStatus.TAB_FORCE_SETTLED] },
        },
      },
    }),
  ])

  const byMode: Record<string, Prisma.Decimal> = {}
  for (const p of payments) {
    byMode[p.mode] = p._sum.amount ?? new Prisma.Decimal(0)
  }

  return {
    billCount: bills._count.id,
    grossTotal: bills._sum.grossTotal ?? new Prisma.Decimal(0),
    discountTotal: bills._sum.discountTotal ?? new Prisma.Decimal(0),
    netCollectible: bills._sum.netCollectible ?? new Prisma.Decimal(0),
    byMode,
  }
}

export async function getBillLines(range: DateRange, limit = 200) {
  return prisma.bill.findMany({
    where: {
      businessDate: dateRange(range),
      status: { in: [BillStatus.COMMITTED, BillStatus.TAB_FORCE_SETTLED] },
    },
    include: {
      lines: {
        where: { isVoidedLine: false },
        include: {
          productSize: { include: { product: { select: { name: true, category: true } } } },
          miscItem: { select: { name: true, category: true } },
        },
      },
      payments: true,
      operator: { select: { name: true } },
      clerk: { select: { name: true } },
    },
    orderBy: { billedAt: "desc" },
    take: limit,
  })
}

export async function getVoidedBills(range: DateRange) {
  return prisma.bill.findMany({
    where: { businessDate: dateRange(range), status: BillStatus.VOIDED },
    include: {
      operator: { select: { name: true } },
      voidedBy: { select: { name: true } },
      lines: { where: { isVoidedLine: false } },
    },
    orderBy: { voidedAt: "desc" },
    take: 100,
  })
}

export async function getExpensesSummary(range: DateRange) {
  const expenses = await prisma.expenditure.findMany({
    where: { expDate: dateRange(range) },
    include: { categoryRef: { select: { name: true } } },
    orderBy: { expDate: "desc" },
  })

  const total = expenses.reduce((sum, e) => sum.plus(e.amount), new Prisma.Decimal(0))
  return { expenses, total }
}

export async function getTopSellers(range: DateRange, limit = 20) {
  const rows = await prisma.billLine.groupBy({
    by: ["productSizeId"],
    _sum: { quantity: true, lineTotal: true },
    where: {
      sourceType: "LIQUOR",
      isVoidedLine: false,
      productSizeId: { not: null },
      bill: {
        businessDate: dateRange(range),
        status: { in: [BillStatus.COMMITTED, BillStatus.TAB_FORCE_SETTLED] },
      },
    },
    orderBy: { _sum: { quantity: "desc" } },
    take: limit,
  })

  const sizeIds = rows.map((r) => r.productSizeId).filter(Boolean) as number[]
  const sizes = await prisma.productSize.findMany({
    where: { id: { in: sizeIds } },
    include: { product: { select: { name: true, category: true } } },
  })
  const sizeMap = new Map(sizes.map((s) => [s.id, s]))

  return rows.map((r) => ({
    productSize: sizeMap.get(r.productSizeId!),
    totalQty: r._sum.quantity ?? 0,
    totalRevenue: r._sum.lineTotal ?? new Prisma.Decimal(0),
  }))
}

export async function getClerkPerformance(range: DateRange) {
  return prisma.bill.groupBy({
    by: ["clerkId"],
    _count: { id: true },
    _sum: { netCollectible: true },
    where: {
      attributionType: "CLERK",
      clerkId: { not: null },
      businessDate: dateRange(range),
      status: { in: [BillStatus.COMMITTED, BillStatus.TAB_FORCE_SETTLED] },
    },
  })
}

export async function getAuditLog(range: DateRange, limit = 200) {
  return prisma.auditEvent.findMany({
    where: {
      occurredAt: {
        gte: parseDateParam(range.from),
        lte: new Date(parseDateParam(range.to).getTime() + 86400000),
      },
    },
    include: { actor: { select: { name: true } } },
    orderBy: { occurredAt: "desc" },
    take: limit,
  })
}
