import { Prisma } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"

import { getAvailableStock } from "@/lib/domains/inventory/stock"
import { resolveRate } from "@/lib/domains/inventory/clearance"

import { computeCart } from "./compute"

vi.mock("@/lib/domains/inventory/stock", () => ({
  getAvailableStock: vi.fn(),
}))

vi.mock("@/lib/domains/inventory/clearance", () => ({
  resolveRate: vi.fn(),
}))

describe("computeCart", () => {
  it("prices liquor and misc items with third-party split", async () => {
    vi.mocked(getAvailableStock).mockResolvedValue(5)
    vi.mocked(resolveRate).mockResolvedValue([
      { rate: new Prisma.Decimal("100"), quantity: 2, clearanceBatchId: 1 },
    ])

    const tx = {
      productSize: {
        findUniqueOrThrow: vi.fn(async () => ({
          sellingPrice: new Prisma.Decimal("100"),
          product: { name: "Amrut" },
          sizeMl: 90,
        })),
      },
      miscItem: {
        findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: number } }) => {
          if (where.id === 501) {
            return { name: "Cigarettes", price: new Prisma.Decimal("20"), isThirdParty: true }
          }
          return { name: "Cup", price: new Prisma.Decimal("15"), isThirdParty: false }
        }),
      },
    }

    const result = await computeCart(tx as unknown as Parameters<typeof computeCart>[0], {
      lines: [
        { kind: "LIQUOR", productSizeId: 11, quantity: 2 },
        { kind: "MISC", miscItemId: 501, quantity: 3 },
        { kind: "MISC", miscItemId: 502, quantity: 1 },
      ],
    })

    expect(result.total).toBe(275)
    expect(result.ownerSubtotal).toBe(215)
    expect(result.thirdPartySubtotal).toBe(60)
    expect(result.warnings).toEqual([])
    expect(result.lines).toHaveLength(3)
    expect(result.lines[0].availableStock).toBe(5)
    expect(result.lines[1].isThirdParty).toBe(true)
  })
})
