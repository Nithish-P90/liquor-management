import { Prisma } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"

import { prisma } from "@/lib/platform/prisma"

import { thirdPartyPayoutSummary } from "./third-party-ledger"

vi.mock("@/lib/platform/prisma", () => ({
  prisma: {
    billLine: { findMany: vi.fn() },
  },
}))

describe("thirdPartyPayoutSummary", () => {
  it("aggregates payouts by bill and item", async () => {
    const date = new Date("2026-05-01T00:00:00.000Z")

    vi.mocked(prisma.billLine.findMany).mockResolvedValue([
      {
        miscItemId: 501,
        miscItem: { name: "Cigarettes" },
        quantity: 2,
        lineTotal: new Prisma.Decimal("40"),
        bill: { id: 1, billNumber: "MV/2026-27/00001", businessDate: date, thirdPartyTotal: new Prisma.Decimal("60") },
      },
      {
        miscItemId: 501,
        miscItem: { name: "Cigarettes" },
        quantity: 1,
        lineTotal: new Prisma.Decimal("20"),
        bill: { id: 1, billNumber: "MV/2026-27/00001", businessDate: date, thirdPartyTotal: new Prisma.Decimal("60") },
      },
      {
        miscItemId: 502,
        miscItem: { name: "Soda" },
        quantity: 3,
        lineTotal: new Prisma.Decimal("30"),
        bill: { id: 2, billNumber: "MV/2026-27/00002", businessDate: date, thirdPartyTotal: new Prisma.Decimal("30") },
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.billLine.findMany>>)

    const result = await thirdPartyPayoutSummary({
      from: new Date("2026-05-01T00:00:00.000Z"),
      to: new Date("2026-05-02T00:00:00.000Z"),
    })

    expect(result.totalSales).toBe(90)
    expect(result.bills).toEqual([
      { billId: 1, billNumber: "MV/2026-27/00001", date: "2026-05-01", amount: 60 },
      { billId: 2, billNumber: "MV/2026-27/00002", date: "2026-05-01", amount: 30 },
    ])
    expect(result.itemBreakdown[0]).toEqual({ miscItemId: 501, name: "Cigarettes", qty: 3, amount: 60 })
  })
})
