import { BillStatus, Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"

const settledBillStatuses = [BillStatus.COMMITTED, BillStatus.TAB_SETTLED, BillStatus.TAB_FORCE_SETTLED]

export async function getTopSellingItems(limit = 5) {
  const items = await prisma.billLine.groupBy({
    by: ["productSizeId"],
    _sum: {
      quantity: true,
      lineTotal: true,
    },
    where: {
      sourceType: "LIQUOR",
      isVoidedLine: false,
      productSizeId: { not: null },
      bill: {
        status: { in: settledBillStatuses },
      },
    },
    orderBy: {
      _sum: {
        quantity: "desc",
      },
    },
    take: limit,
  })

  const productSizeIds = items.map((item) => item.productSizeId).filter(Boolean) as number[]
  const sizes = await prisma.productSize.findMany({
    where: { id: { in: productSizeIds } },
    include: { product: { select: { name: true, category: true } } },
  })
  const sizeById = new Map(sizes.map((size) => [size.id, size]))

  return items.map((item) => ({
    ...item,
    productSize: sizeById.get(item.productSizeId!),
    totalQuantity: item._sum.quantity ?? 0,
    totalRevenue: item._sum.lineTotal ?? new Prisma.Decimal(0),
  }))
}

export async function getSalesByPaymentMode() {
  return prisma.paymentAllocation.groupBy({
    by: ["mode"],
    _sum: {
      amount: true,
    },
    where: {
      bill: {
        status: { in: settledBillStatuses },
      },
    },
  })
}
