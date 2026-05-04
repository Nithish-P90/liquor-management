import { describe, it, expect, vi } from "vitest"

import { getStockSnapshot, normalizeStockEntry, splitStock } from "./stock"

describe("splitStock", () => {
  it("splits total bottles into full cases plus a loose remainder", () => {
    expect(splitStock(0, 12)).toEqual({ cases: 0, bottles: 0 })
    expect(splitStock(11, 12)).toEqual({ cases: 0, bottles: 11 })
    expect(splitStock(12, 12)).toEqual({ cases: 1, bottles: 0 })
    expect(splitStock(13, 12)).toEqual({ cases: 1, bottles: 1 })
    expect(splitStock(59, 12)).toEqual({ cases: 4, bottles: 11 })
    expect(splitStock(60, 12)).toEqual({ cases: 5, bottles: 0 })
  })

  it("handles the other size conventions used by the workbook", () => {
    expect(splitStock(48, 48)).toEqual({ cases: 1, bottles: 0 })
    expect(splitStock(96, 48)).toEqual({ cases: 2, bottles: 0 })
    expect(splitStock(25, 25)).toEqual({ cases: 1, bottles: 0 })
    expect(splitStock(49, 24)).toEqual({ cases: 2, bottles: 1 })
  })

  it("never returns a negative value even for nonsense input", () => {
    expect(splitStock(-5, 12)).toEqual({ cases: 0, bottles: 0 })
  })

  it("treats a zero or negative pack size as an all-loose bag of bottles", () => {
    expect(splitStock(37, 0)).toEqual({ cases: 0, bottles: 37 })
    expect(splitStock(37, -1)).toEqual({ cases: 0, bottles: 37 })
  })
})

describe("normalizeStockEntry — additive (receipt / void reversal) direction", () => {
  it("overflows loose bottles into cases when the loose count crosses a pack boundary", () => {
    // Spec §10: Add 1 to [4 cases, 11 loose, pack=12] -> [5 cases, 0 loose]
    expect(normalizeStockEntry(4, 12, 12)).toEqual({ cases: 5, bottles: 0, totalBottles: 60 })

    // Spec §10: Add 5 to [3 cases, 10 loose, pack=12] -> [4 cases, 3 loose]
    // The caller passes the post-add figures in (3 cases, 15 loose) and normalize folds them.
    expect(normalizeStockEntry(3, 15, 12)).toEqual({ cases: 4, bottles: 3, totalBottles: 51 })
  })

  it("leaves the already-normalized form untouched", () => {
    expect(normalizeStockEntry(5, 0, 12)).toEqual({ cases: 5, bottles: 0, totalBottles: 60 })
    expect(normalizeStockEntry(5, 11, 12)).toEqual({ cases: 5, bottles: 11, totalBottles: 71 })
  })

  it("coerces non-integer and negative inputs to safe non-negative integers", () => {
    expect(normalizeStockEntry(-1, 4, 12)).toEqual({ cases: 0, bottles: 4, totalBottles: 4 })
    expect(normalizeStockEntry(3.9, 0, 12)).toEqual({ cases: 3, bottles: 0, totalBottles: 36 })
    expect(normalizeStockEntry(Number.NaN, 5, 12)).toEqual({ cases: 0, bottles: 5, totalBottles: 5 })
  })

  it("degrades gracefully when pack size is zero — everything is loose", () => {
    expect(normalizeStockEntry(3, 5, 0)).toEqual({ cases: 0, bottles: 8, totalBottles: 8 })
  })
})

describe("total-bottles invariant (deduction math — preview of Slice 1)", () => {
  // splitStock + normalizeStockEntry together define the round-trip invariant
  // that the POS commit engine will rely on:
  //   normalize(cases, bottles, pack).totalBottles === cases * pack + bottles
  //   splitStock(totalBottles, pack).cases * pack + splitStock(totalBottles, pack).bottles === totalBottles
  //
  // These tests are the concrete spec §10 deduction cases, phrased in terms
  // of the pre- and post-state each deduction should produce.

  const deduct = (cases: number, loose: number, pack: number, qty: number) => {
    const total = cases * pack + loose - qty
    return splitStock(total, pack)
  }

  it("deducts 1 from [5 cases, 0 loose, pack=12] -> [4 cases, 11 loose]", () => {
    expect(deduct(5, 0, 12, 1)).toEqual({ cases: 4, bottles: 11 })
  })

  it("deducts 12 from [5 cases, 5 loose, pack=12] -> [4 cases, 5 loose]", () => {
    expect(deduct(5, 5, 12, 12)).toEqual({ cases: 4, bottles: 5 })
  })

  it("deducts 7 from [0 cases, 7 loose] -> [0 cases, 0 loose]", () => {
    expect(deduct(0, 7, 12, 7)).toEqual({ cases: 0, bottles: 0 })
  })

  it("going below zero is the caller's job to block — this helper just clamps to zero", () => {
    // Deduct 8 from [0 cases, 7 loose] — commitBill must refuse before ever
    // calling into stock math. If the clamp ever activates in production,
    // that's a missed guard, not a correct behavior.
    expect(deduct(0, 7, 12, 8)).toEqual({ cases: 0, bottles: 0 })
  })
})

describe("getStockSnapshot", () => {
  it("aggregates opening, receipts, sold, pending, and adjustments", async () => {
    const tx = {
      inventorySession: {
        findFirst: vi.fn(async () => ({
          id: 1,
          periodStart: new Date("2026-05-01T00:00:00.000Z"),
          periodEnd: new Date("2026-05-02T00:00:00.000Z"),
        })),
      },
      stockEntry: {
        findMany: vi.fn(async () => [{ productSizeId: 11, totalBottles: 20 }]),
      },
      receiptItem: {
        groupBy: vi.fn(async () => [{ productSizeId: 11, _sum: { totalBottles: 10 } }]),
      },
      billLine: {
        groupBy: vi.fn(async ({ where }: { where: { bill?: { status?: string } } }) => {
          if (where.bill?.status === "TAB_OPEN") {
            return [{ productSizeId: 11, _sum: { quantity: 2 } }]
          }
          return [{ productSizeId: 11, _sum: { quantity: 8 } }]
        }),
      },
      stockAdjustment: {
        groupBy: vi.fn(async ({ where }: { where: { adjustmentType?: { not?: string; in?: string[] } } }) => {
          if (where.adjustmentType?.in) {
            return [{ productSizeId: 11, _sum: { quantityBottles: 1 } }]
          }
          return [{ productSizeId: 11, _sum: { quantityBottles: 4 } }]
        }),
      },
    }

    const snapshot = await getStockSnapshot(tx as unknown as Parameters<typeof getStockSnapshot>[0], { productSizeIds: [11] })
    const row = snapshot.get(11)

    expect(row).toEqual({
      openingBottles: 20,
      receiptBottles: 10,
      soldBottles: 8,
      adjustmentBottles: 3,
      pendingBottles: 2,
      totalBottles: 23,
    })
  })

  it("prefers the active session for today over the newest session", async () => {
    const tx = {
      inventorySession: {
        findFirst: vi.fn(async ({ where }: { where?: { periodStart?: { lte?: Date }; periodEnd?: { gte?: Date }; locked?: boolean } }) => {
          if (where?.locked === false && where?.periodStart?.lte && where?.periodEnd?.gte) {
            return {
              id: 1,
              periodStart: new Date("2026-05-01T00:00:00.000Z"),
              periodEnd: new Date("2026-05-02T00:00:00.000Z"),
            }
          }

          return {
            id: 2,
            periodStart: new Date("2026-05-03T00:00:00.000Z"),
            periodEnd: new Date("2026-05-04T00:00:00.000Z"),
          }
        }),
      },
      stockEntry: {
        findMany: vi.fn(async ({ where }: { where: { sessionId: number } }) => {
          if (where.sessionId === 1) {
            return [{ productSizeId: 11, totalBottles: 41 }]
          }
          return [{ productSizeId: 11, totalBottles: 5 }]
        }),
      },
      receiptItem: {
        groupBy: vi.fn(async () => []),
      },
      billLine: {
        groupBy: vi.fn(async () => []),
      },
      stockAdjustment: {
        groupBy: vi.fn(async () => []),
      },
    }

    const snapshot = await getStockSnapshot(tx as unknown as Parameters<typeof getStockSnapshot>[0], { productSizeIds: [11] })

    expect(snapshot.get(11)?.openingBottles).toBe(41)
  })
})
