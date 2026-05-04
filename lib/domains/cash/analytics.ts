import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/platform/prisma"
import { REVENUE_BILL_WHERE, REVENUE_LINE_WHERE } from "../billing/bill"

export async function getTopSellingItems(limit = 5) {
  const refinedItems = await prisma.billLine.groupBy({
    by: ["productSizeId"],
    _sum: {
      quantity: true,
      lineTotal: true,
    },
    where: {
      ...REVENUE_LINE_WHERE,
      sourceType: "LIQUOR",
      productSizeId: { not: null },
    },
    orderBy: {
      _sum: {
        quantity: "desc",
      },
    },
    take: limit,
  })

  const productSizeIds = refinedItems.map((item) => item.productSizeId).filter(Boolean) as number[]
  const sizes = await prisma.productSize.findMany({
    where: { id: { in: productSizeIds } },
    include: { product: { select: { name: true, category: true } } },
  })
  const sizeById = new Map(sizes.map((size) => [size.id, size]))

  return refinedItems.map((item) => ({
    ...item,
    productSize: sizeById.get(item.productSizeId!),
    totalQuantity: item._sum.quantity ?? 0,
    totalRevenue: item._sum.lineTotal ?? new Prisma.Decimal(0),
  }))
}

export async function getSalesByPaymentMode() {
  const bills = await prisma.bill.findMany({
    where: {
      ...REVENUE_BILL_WHERE,
    },
    select: {
      status: true,
      netCollectible: true,
      payments: {
        select: {
          mode: true,
          amount: true,
        },
      },
    },
  })

  const byMode = new Map<string, Prisma.Decimal>()

  for (const bill of bills) {
    const sign = bill.status === "VOIDED" && bill.netCollectible.lt(0) ? new Prisma.Decimal(-1) : new Prisma.Decimal(1)
    for (const payment of bill.payments) {
      const current = byMode.get(payment.mode) ?? new Prisma.Decimal(0)
      byMode.set(payment.mode, current.plus(sign.times(payment.amount)))
    }
  }

  return Array.from(byMode.entries()).map(([mode, amount]) => ({
    mode,
    _sum: { amount },
  })
)
}
