import { MiscCategory, Prisma } from "@prisma/client"

import { REVENUE_BILL_WHERE } from "@/lib/domains/billing/bill"
import { parseDateParam } from "@/lib/platform/dates"
import { DateString, toDateString } from "@/lib/platform/types"

export type MiscItemInput = {
  name: string
  category: MiscCategory
  unit: string
  price: number | Prisma.Decimal
  barcode?: string | null
  active?: boolean
  isThirdParty?: boolean
}

export type MiscSalesRange = {
  from: DateString
  to: DateString
}

export type MiscItemMetric = {
  miscItemId: number | null
  itemName: string
  category: string
  unit: string
  quantity: number
  grossRevenue: number
  ownerRevenue: number
  thirdPartyRevenue: number
}

export type MiscSalesMetrics = {
  from: DateString
  to: DateString
  billCount: number
  quantity: number
  grossRevenue: number
  ownerRevenue: number
  thirdPartyRevenue: number
  items: MiscItemMetric[]
}

function toDecimal(value: number | Prisma.Decimal): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value.toFixed(2))
}

export async function listMiscItems(tx: Prisma.TransactionClient) {
  return tx.miscItem.findMany({
    orderBy: [{ active: "desc" }, { category: "asc" }, { name: "asc" }],
  })
}

export async function createMiscItem(tx: Prisma.TransactionClient, input: MiscItemInput) {
  return tx.miscItem.create({
    data: {
      name: input.name.trim(),
      category: input.category,
      unit: input.unit.trim(),
      price: toDecimal(input.price),
      barcode: input.barcode?.trim() || null,
      active: input.active ?? true,
      isThirdParty: input.isThirdParty ?? false,
    },
  })
}

export async function updateMiscItem(tx: Prisma.TransactionClient, id: number, input: MiscItemInput) {
  return tx.miscItem.update({
    where: { id },
    data: {
      name: input.name.trim(),
      category: input.category,
      unit: input.unit.trim(),
      price: toDecimal(input.price),
      barcode: input.barcode?.trim() || null,
      active: input.active ?? true,
      isThirdParty: input.isThirdParty ?? false,
    },
  })
}

export async function getMiscSalesMetrics(tx: Prisma.TransactionClient, range: MiscSalesRange): Promise<MiscSalesMetrics> {
  const dateRange = { gte: parseDateParam(range.from), lte: parseDateParam(range.to) }

  const lines = await tx.billLine.findMany({
    where: {
      sourceType: "MISC",
      isVoidedLine: false,
      bill: {
        ...REVENUE_BILL_WHERE,
        businessDate: dateRange,
      },
    },
    select: {
      billId: true,
      miscItemId: true,
      itemNameSnapshot: true,
      quantity: true,
      lineTotal: true,
      isThirdPartySnapshot: true,
      miscItem: {
        select: {
          name: true,
          category: true,
          unit: true,
        },
      },
    },
  })

  const summary = new Map<number | null, MiscItemMetric>()
  let quantity = 0
  let grossRevenue = 0
  let ownerRevenue = 0
  let thirdPartyRevenue = 0
  const billIds = new Set<number>()

  for (const line of lines) {
    billIds.add(line.billId)
    const lineAmount = Number(line.lineTotal)
    quantity += line.quantity
    grossRevenue += lineAmount
    if (line.isThirdPartySnapshot) {
      thirdPartyRevenue += lineAmount
    } else {
      ownerRevenue += lineAmount
    }

    const key = line.miscItemId
    const existing = summary.get(key)
    const itemName = line.miscItem?.name ?? line.itemNameSnapshot
    const category = line.miscItem?.category ?? "UNKNOWN"
    const unit = line.miscItem?.unit ?? "pcs"

    if (!existing) {
      summary.set(key, {
        miscItemId: key,
        itemName,
        category,
        unit,
        quantity: line.quantity,
        grossRevenue: lineAmount,
        ownerRevenue: line.isThirdPartySnapshot ? 0 : lineAmount,
        thirdPartyRevenue: line.isThirdPartySnapshot ? lineAmount : 0,
      })
      continue
    }

    existing.quantity += line.quantity
    existing.grossRevenue += lineAmount
    if (line.isThirdPartySnapshot) {
      existing.thirdPartyRevenue += lineAmount
    } else {
      existing.ownerRevenue += lineAmount
    }
  }

  return {
    from: toDateString(parseDateParam(range.from)),
    to: toDateString(parseDateParam(range.to)),
    billCount: billIds.size,
    quantity,
    grossRevenue,
    ownerRevenue,
    thirdPartyRevenue,
    items: Array.from(summary.values()).sort((a, b) => b.grossRevenue - a.grossRevenue),
  }
}