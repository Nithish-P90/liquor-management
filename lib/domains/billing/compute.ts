import { Prisma } from "@prisma/client"
import { getAvailableStock, PrismaTransactionClient } from "@/lib/domains/inventory/stock"
import { resolveRate } from "@/lib/domains/inventory/clearance"

export type CartLineInput = {
  kind: "LIQUOR" | "MISC"
  productSizeId?: number
  miscItemId?: number
  quantity: number
}

export type PricedLine = {
  key: string               // "ps-<id>" | "mi-<id>"
  kind: "LIQUOR" | "MISC"
  itemName: string
  unitPrice: number
  quantity: number
  lineTotal: number
  isThirdParty: boolean
  availableStock: number | null  // null for MISC (unlimited)
}

export type PricedCart = {
  lines: PricedLine[]
  total: number
  ownerSubtotal: number        // liquor + owner MISC
  thirdPartySubtotal: number   // third-party MISC only
  warnings: string[]           // out-of-stock notices (non-fatal)
}

/**
 * Read-only cart pricer. Resolves canonical prices (clearance-aware for liquor,
 * MiscItem.price for misc) and computes revenue split between owner and third-party.
 * Used by the /api/pos/bills/compute endpoint for the UI payment screen preview.
 * commitBill does its own internal price resolution — this function is for display only.
 */
export async function computeCart(
  tx: PrismaTransactionClient,
  input: { lines: CartLineInput[] },
): Promise<PricedCart> {
  const lines: PricedLine[] = []
  const warnings: string[] = []
  let ownerSubtotal = new Prisma.Decimal(0)
  let thirdPartySubtotal = new Prisma.Decimal(0)

  // Group LIQUOR lines to aggregate stock checks per productSizeId
  const requestedQtyBySize = new Map<number, number>()
  for (const l of input.lines) {
    if (l.kind === "LIQUOR" && l.productSizeId != null) {
      requestedQtyBySize.set(l.productSizeId, (requestedQtyBySize.get(l.productSizeId) ?? 0) + l.quantity)
    }
  }

  const stockBySize = new Map<number, number>()
  for (const sizeId of Array.from(requestedQtyBySize.keys())) {
    const available = await getAvailableStock(tx, sizeId, {})
    stockBySize.set(sizeId, available)
  }

  for (const l of input.lines) {
    if (l.kind === "LIQUOR" && l.productSizeId != null) {
      const productSize = await tx.productSize.findUniqueOrThrow({
        where: { id: l.productSizeId },
        select: { sellingPrice: true, product: { select: { name: true } }, sizeMl: true },
      })

      // Use clearance-aware pricing (same as commitBill)
      const segments = await resolveRate(tx, l.productSizeId, l.quantity)
      let lineTotal = new Prisma.Decimal(0)
      let unitPrice = productSize.sellingPrice

      if (segments.length > 0) {
        // Use first segment rate as display unit price (accurate for single-segment)
        unitPrice = new Prisma.Decimal(segments[0].rate.toString())
        for (const seg of segments) {
          lineTotal = lineTotal.plus(new Prisma.Decimal(seg.rate.toString()).times(seg.quantity))
        }
      } else {
        lineTotal = unitPrice.times(l.quantity)
      }

      const available = stockBySize.get(l.productSizeId) ?? 0
      if (available < l.quantity) {
        warnings.push(
          `${productSize.product.name} ${productSize.sizeMl}ml: only ${available} available, requested ${l.quantity}`,
        )
      }

      ownerSubtotal = ownerSubtotal.plus(lineTotal)
      lines.push({
        key: `ps-${l.productSizeId}`,
        kind: "LIQUOR",
        itemName: `${productSize.product.name} ${productSize.sizeMl}ml`,
        unitPrice: Number(unitPrice),
        quantity: l.quantity,
        lineTotal: Number(lineTotal),
        isThirdParty: false,
        availableStock: available,
      })
    } else if (l.kind === "MISC" && l.miscItemId != null) {
      const miscItem = await tx.miscItem.findUniqueOrThrow({
        where: { id: l.miscItemId },
        select: { name: true, price: true, isThirdParty: true },
      })

      const lineTotal = miscItem.price.times(l.quantity)

      if (miscItem.isThirdParty) {
        thirdPartySubtotal = thirdPartySubtotal.plus(lineTotal)
      } else {
        ownerSubtotal = ownerSubtotal.plus(lineTotal)
      }

      lines.push({
        key: `mi-${l.miscItemId}`,
        kind: "MISC",
        itemName: miscItem.name,
        unitPrice: Number(miscItem.price),
        quantity: l.quantity,
        lineTotal: Number(lineTotal),
        isThirdParty: miscItem.isThirdParty,
        availableStock: null,
      })
    }
  }

  const total = ownerSubtotal.plus(thirdPartySubtotal)

  return {
    lines,
    total: Number(total),
    ownerSubtotal: Number(ownerSubtotal),
    thirdPartySubtotal: Number(thirdPartySubtotal),
    warnings,
  }
}
