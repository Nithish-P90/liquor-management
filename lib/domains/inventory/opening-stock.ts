import { prisma } from "@/lib/platform/prisma"
import { normalizeStockEntry } from "@/lib/domains/inventory/stock"

export type OpeningStockInput = {
  productSizeId: number
  cases: number
  bottles: number
}

export type OpeningStockRow = {
  productSizeId: number
  productId: number
  name: string
  sizeMl: number
  bottlesPerCase: number
  cases: number
  bottles: number
  totalBottles: number
}

export type OpeningStockSnapshot = {
  sessionId: number
  locked: boolean
  items: OpeningStockRow[]
}

type OpeningSession = {
  id: number
  locked: boolean
}

async function loadOpeningSession(sessionId: number): Promise<OpeningSession | null> {
  return prisma.inventorySession.findUnique({
    where: { id: sessionId },
    select: { id: true, locked: true },
  })
}

export async function getOpeningStockSnapshot(sessionId: number): Promise<OpeningStockSnapshot | null> {
  const session = await loadOpeningSession(sessionId)
  if (!session) return null

  const entries = await prisma.stockEntry.findMany({
    where: { sessionId, entryType: "OPENING" },
    select: {
      productSizeId: true,
      cases: true,
      bottles: true,
      totalBottles: true,
      productSize: {
        select: {
          id: true,
          sizeMl: true,
          bottlesPerCase: true,
          product: { select: { id: true, name: true } },
        },
      },
    },
  })

  const items = entries
    .map((entry) => ({
      productSizeId: entry.productSizeId,
      productId: entry.productSize.product.id,
      name: entry.productSize.product.name,
      sizeMl: entry.productSize.sizeMl,
      bottlesPerCase: entry.productSize.bottlesPerCase,
      cases: entry.cases,
      bottles: entry.bottles,
      totalBottles: entry.totalBottles,
    }))
    .sort((left, right) => left.name.localeCompare(right.name) || right.sizeMl - left.sizeMl)

  return {
    sessionId: session.id,
    locked: session.locked,
    items,
  }
}

export async function replaceOpeningStockSnapshot(
  sessionId: number,
  items: OpeningStockInput[],
): Promise<{ sessionId: number; itemCount: number }> {
  return prisma.$transaction(async (tx) => {
    const session = await tx.inventorySession.findUnique({
      where: { id: sessionId },
      select: { id: true, locked: true },
    })

    if (!session) {
      throw new Error("Inventory session not found")
    }

    if (session.locked) {
      throw new Error("Inventory session is locked")
    }

    const productSizes = await tx.productSize.findMany({
      where: { id: { in: items.map((item) => item.productSizeId) } },
      select: { id: true, bottlesPerCase: true },
    })

    const sizeMap = new Map(productSizes.map((size) => [size.id, size]))
    const itemIds = new Set(items.map((item) => item.productSizeId))

    await tx.stockEntry.deleteMany({
      where: {
        sessionId,
        entryType: "OPENING",
        productSizeId: { notIn: Array.from(itemIds) },
      },
    })

    for (const item of items) {
      const size = sizeMap.get(item.productSizeId)
      if (!size) {
        throw new Error(`ProductSize ${item.productSizeId} not found`) 
      }

      const normalized = normalizeStockEntry(item.cases, item.bottles, size.bottlesPerCase)

      await tx.stockEntry.upsert({
        where: {
          sessionId_productSizeId_entryType: {
            sessionId,
            productSizeId: item.productSizeId,
            entryType: "OPENING",
          },
        },
        update: {
          cases: normalized.cases,
          bottles: normalized.bottles,
          totalBottles: normalized.totalBottles,
        },
        create: {
          sessionId,
          productSizeId: item.productSizeId,
          entryType: "OPENING",
          cases: normalized.cases,
          bottles: normalized.bottles,
          totalBottles: normalized.totalBottles,
        },
      })
    }

    return { sessionId, itemCount: items.length }
  })
}