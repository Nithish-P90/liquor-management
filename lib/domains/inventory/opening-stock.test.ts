import { beforeEach, describe, expect, it, vi } from "vitest"

const prismaMock = vi.hoisted(() => ({
  prisma: {
    inventorySession: {
      findUnique: vi.fn(),
    },
    stockEntry: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
    productSize: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/platform/prisma", () => prismaMock)

import { getOpeningStockSnapshot, replaceOpeningStockSnapshot } from "./opening-stock"

describe("opening-stock", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns the opening stock rows for a session", async () => {
    prismaMock.prisma.inventorySession.findUnique.mockResolvedValue({ id: 9, locked: false })
    prismaMock.prisma.stockEntry.findMany.mockResolvedValue([
      {
        productSizeId: 2,
        cases: 4,
        bottles: 3,
        totalBottles: 51,
        productSize: {
          id: 2,
          sizeMl: 750,
          bottlesPerCase: 12,
          product: { id: 1, name: "Alpha" },
        },
      },
      {
        productSizeId: 1,
        cases: 1,
        bottles: 0,
        totalBottles: 12,
        productSize: {
          id: 1,
          sizeMl: 500,
          bottlesPerCase: 12,
          product: { id: 1, name: "Beta" },
        },
      },
    ])

    const snapshot = await getOpeningStockSnapshot(9)

    expect(snapshot).toEqual({
      sessionId: 9,
      locked: false,
      items: [
        {
          productSizeId: 2,
          productId: 1,
          name: "Alpha",
          sizeMl: 750,
          bottlesPerCase: 12,
          cases: 4,
          bottles: 3,
          totalBottles: 51,
        },
        {
          productSizeId: 1,
          productId: 1,
          name: "Beta",
          sizeMl: 500,
          bottlesPerCase: 12,
          cases: 1,
          bottles: 0,
          totalBottles: 12,
        },
      ],
    })
  })

  it("replaces opening stock atomically", async () => {
    const tx = {
      inventorySession: {
        findUnique: vi.fn(async () => ({ id: 9, locked: false })),
      },
      productSize: {
        findMany: vi.fn(async () => [
          { id: 1, bottlesPerCase: 12 },
          { id: 2, bottlesPerCase: 24 },
        ]),
      },
      stockEntry: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
        upsert: vi.fn(async () => ({})),
      },
    }

    prismaMock.prisma.$transaction.mockImplementation(async (callback) => callback(tx as never))

    const result = await replaceOpeningStockSnapshot(9, [
      { productSizeId: 1, cases: 2, bottles: 0 },
      { productSizeId: 2, cases: 1, bottles: 12 },
    ])

    expect(result).toEqual({ sessionId: 9, itemCount: 2 })
    expect(tx.stockEntry.deleteMany).toHaveBeenCalledWith({
      where: {
        sessionId: 9,
        entryType: "OPENING",
        productSizeId: { notIn: [1, 2] },
      },
    })
    expect(tx.stockEntry.upsert).toHaveBeenCalledTimes(2)
  })
})