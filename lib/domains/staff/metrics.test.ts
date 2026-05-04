import { describe, expect, it, vi } from "vitest"

import { prisma } from "@/lib/platform/prisma"

import { staffMetrics } from "./metrics"

vi.mock("@/lib/platform/prisma", () => ({
  prisma: {
    staff: { findMany: vi.fn() },
  },
}))

describe("staffMetrics", () => {
  it("computes revenue splits and attendance counts", async () => {
    vi.mocked(prisma.staff.findMany).mockResolvedValue([
      {
        id: 1,
        name: "Ravi",
        role: "CASHIER",
        billsOperated: [
          { netCollectible: "100", ownerTotal: "80", cashierTotal: "20", thirdPartyTotal: "5" },
          { netCollectible: "50", ownerTotal: "40", cashierTotal: "10", thirdPartyTotal: "0" },
        ],
        _count: { attendanceLogs: 3 },
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.staff.findMany>>)

    const result = await staffMetrics()

    expect(result).toEqual([
      {
        staffId: 1,
        name: "Ravi",
        role: "CASHIER",
        billsHandled: 2,
        totalRevenue: 150,
        liquorRevenue: 120,
        miscRevenue: 30,
        thirdPartyRevenue: 5,
        ownerNetRevenue: 145,
        attendanceDays: 3,
      },
    ])
  })
})
