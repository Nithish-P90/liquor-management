import { Prisma } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"

import { prisma } from "@/lib/platform/prisma"

import { getSalesByPaymentMode } from "./analytics"

vi.mock("@/lib/platform/prisma", () => ({
  prisma: {
    bill: {
      findMany: vi.fn(),
    },
  },
}))

describe("getSalesByPaymentMode", () => {
  it("subtracts voided bill payments from the distribution totals", async () => {
    vi.mocked(prisma.bill.findMany).mockResolvedValue([
      {
        status: "COMMITTED",
        netCollectible: new Prisma.Decimal("5400"),
        payments: [{ mode: "CASH", amount: new Prisma.Decimal("5400") }],
      },
      {
        status: "VOIDED",
        netCollectible: new Prisma.Decimal("-1200"),
        payments: [{ mode: "CASH", amount: new Prisma.Decimal("1200") }],
      },
      {
        status: "VOIDED",
        netCollectible: new Prisma.Decimal("-300"),
        payments: [{ mode: "CARD", amount: new Prisma.Decimal("300") }],
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.bill.findMany>>)

    const result = await getSalesByPaymentMode()

    expect(result).toEqual([
      { mode: "CASH", _sum: { amount: new Prisma.Decimal("4200") } },
      { mode: "CARD", _sum: { amount: new Prisma.Decimal("-300") } },
    ])
  })
})