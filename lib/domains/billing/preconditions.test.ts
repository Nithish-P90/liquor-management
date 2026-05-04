import { beforeEach, describe, expect, it, vi } from "vitest"

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/platform/prisma"
import { ensureDailyRollover } from "@/lib/domains/inventory/rollover"

import { checkBillingPreconditions } from "./preconditions"

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}))

vi.mock("@/lib/platform/prisma", () => ({
  prisma: {
    gallaDay: { findUnique: vi.fn() },
    inventorySession: { findFirst: vi.fn() },
  },
}))

vi.mock("@/lib/domains/inventory/rollover", () => ({
  ensureDailyRollover: vi.fn(),
}))

describe("checkBillingPreconditions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects missing session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)

    const result = await checkBillingPreconditions()

    expect(result).toEqual({ ok: false, error: "Unauthorized", status: 401 })
  })

  it("rejects fallback admin", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      { user: { id: "fallback-admin" } } as NonNullable<Awaited<ReturnType<typeof getServerSession>>>,
    )

    const result = await checkBillingPreconditions()

    expect(result).toEqual({
      ok: false,
      error: "Emergency Admin cannot process sales. Log in with a Staff PIN.",
      status: 401,
    })
  })

  it("rejects closed galla day", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      { user: { id: "12" } } as NonNullable<Awaited<ReturnType<typeof getServerSession>>>,
    )
    vi.mocked(prisma.gallaDay.findUnique).mockResolvedValue(
      { isClosed: true } as Awaited<ReturnType<typeof prisma.gallaDay.findUnique>>,
    )

    const result = await checkBillingPreconditions()

    expect(result).toEqual({
      ok: false,
      error: "Day is closed. Sales resume after midnight rollover.",
      status: 409,
    })
  })

  it("rejects missing inventory session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      { user: { id: "12" } } as NonNullable<Awaited<ReturnType<typeof getServerSession>>>,
    )
    vi.mocked(prisma.gallaDay.findUnique).mockResolvedValue(
      { isClosed: false } as Awaited<ReturnType<typeof prisma.gallaDay.findUnique>>,
    )
    vi.mocked(prisma.inventorySession.findFirst).mockResolvedValue(null)
    vi.mocked(ensureDailyRollover).mockResolvedValue("rolled_over")

    const result = await checkBillingPreconditions()

    expect(result).toEqual({
      ok: false,
      error: "No active inventory session. Day rollover may be pending.",
      status: 409,
    })
  })

  it("returns operator and session id when valid", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      { user: { id: "12" } } as NonNullable<Awaited<ReturnType<typeof getServerSession>>>,
    )
    vi.mocked(prisma.gallaDay.findUnique).mockResolvedValue(
      { isClosed: false } as Awaited<ReturnType<typeof prisma.gallaDay.findUnique>>,
    )
    vi.mocked(prisma.inventorySession.findFirst).mockResolvedValue(
      { id: 7 } as Awaited<ReturnType<typeof prisma.inventorySession.findFirst>>,
    )

    const result = await checkBillingPreconditions()

    expect(result).toEqual({ ok: true, operatorId: 12, sessionId: 7 })
  })

  it("re-runs rollover and recovers a missing inventory session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      { user: { id: "12" } } as NonNullable<Awaited<ReturnType<typeof getServerSession>>>,
    )
    vi.mocked(prisma.gallaDay.findUnique).mockResolvedValue(
      { isClosed: false } as Awaited<ReturnType<typeof prisma.gallaDay.findUnique>>,
    )
    vi.mocked(prisma.inventorySession.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 99 } as Awaited<ReturnType<typeof prisma.inventorySession.findFirst>>)
    vi.mocked(ensureDailyRollover).mockResolvedValue("rolled_over")

    const result = await checkBillingPreconditions()

    expect(ensureDailyRollover).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true, operatorId: 12, sessionId: 99 })
  })
})
