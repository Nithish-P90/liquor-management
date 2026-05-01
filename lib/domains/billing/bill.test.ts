/* eslint-disable @typescript-eslint/no-explicit-any */
import { BillStatus, PaymentMode, Prisma } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/platform/dates", async () => {
  const actual = await vi.importActual<typeof import("@/lib/platform/dates")>("@/lib/platform/dates")
  return {
    ...actual,
    todayDateString: vi.fn(() => "2026-04-25"),
  }
})

vi.mock("@/lib/domains/inventory/stock", async () => {
  const actual = await vi.importActual<typeof import("@/lib/domains/inventory/stock")>("@/lib/domains/inventory/stock")
  return {
    ...actual,
    getAvailableStock: vi.fn(),
  }
})

vi.mock("@/lib/domains/inventory/clearance", () => ({
  resolveRate: vi.fn(),
  applyClearanceSegments: vi.fn(),
  reverseClearanceSegments: vi.fn(),
}))

import { nextBillNumber, commitBill, settleTab, voidBill } from "@/lib/domains/billing/bill"
import { todayDateString } from "@/lib/platform/dates"
import { getAvailableStock } from "@/lib/domains/inventory/stock"
import { applyClearanceSegments, resolveRate, reverseClearanceSegments } from "@/lib/domains/inventory/clearance"

type CounterBackedTx = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any
  counters: Map<string, number>
}

function readCounterKeyFromSql(sqlArg: unknown): string {
  const values = (sqlArg as { values?: unknown[] } | undefined)?.values
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Missing SQL values in $queryRaw mock")
  }
  return String(values[0])
}

function createCounterBackedTx(initialCounters: Record<string, number> = {}): CounterBackedTx {
  const counters = new Map<string, number>(Object.entries(initialCounters))

  const tx = {
    $queryRaw: vi.fn(async (sqlArg: unknown) => {
      const key = readCounterKeyFromSql(sqlArg)
      const current = counters.get(key)

      if (current == null) {
        return []
      }

      const next = current + 1
      counters.set(key, next)
      return [{ value: String(next) }]
    }),
    setting: {
      create: vi.fn(async ({ data }: { data: { key: string; value: string } }) => {
        if (counters.has(data.key)) {
          const error = new Error("Duplicate key") as Error & { code?: string }
          error.code = "P2002"
          throw error
        }

        counters.set(data.key, Number.parseInt(data.value, 10))
        return { id: 1, ...data }
      }),
    },
  }

  return { tx, counters }
}

function createCommitTx(counterStart = 0): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any
  createdLines: Array<Record<string, unknown>>
  billCreate: ReturnType<typeof vi.fn>
} {
  const { tx: counterTx } = createCounterBackedTx({ bill_counter_2026_27: counterStart })
  const createdLines: Array<Record<string, unknown>> = []

  const billCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 501,
    ...data,
  }))

  const tx = {
    ...counterTx,
    miscItem: {
      findUniqueOrThrow: vi.fn(async () => ({ price: new Prisma.Decimal("20") })),
    },
    bill: {
      create: billCreate,
    },
    billLine: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdLines.push(data)
        return { id: createdLines.length, ...data }
      }),
    },
    paymentAllocation: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
    auditEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
  }

  return {
    tx,
    createdLines,
    billCreate,
  }
}

beforeEach(() => {
  vi.clearAllMocks()

  vi.mocked(todayDateString).mockReturnValue("2026-04-25" as ReturnType<typeof todayDateString>)
  vi.mocked(getAvailableStock).mockResolvedValue(200)
  vi.mocked(resolveRate).mockImplementation(async (_tx, _productSizeId, qtyNeeded) => [
    { rate: new Prisma.Decimal("120"), quantity: qtyNeeded },
  ])
  vi.mocked(applyClearanceSegments).mockResolvedValue(undefined)
  vi.mocked(reverseClearanceSegments).mockResolvedValue(undefined)
})

describe("nextBillNumber", () => {
  it("bootstraps a fiscal-year counter when missing", async () => {
    const { tx } = createCounterBackedTx()

    const number = await nextBillNumber(tx, "2026-04-25")

    expect(number).toBe("MV/2026-27/00001")
    expect(tx.setting.create).toHaveBeenCalledWith({
      data: {
        key: "bill_counter_2026_27",
        value: "1",
      },
    })
  })

  it("uses April fiscal-year boundaries", async () => {
    const { tx } = createCounterBackedTx({
      bill_counter_2025_26: 7,
      bill_counter_2026_27: 99,
    })

    const march = await nextBillNumber(tx, "2026-03-31")
    const april = await nextBillNumber(tx, "2026-04-01")

    expect(march).toBe("MV/2025-26/00008")
    expect(april).toBe("MV/2026-27/00100")
  })

  it("produces unique sequential values under 100 concurrent calls", async () => {
    const { tx } = createCounterBackedTx({ bill_counter_2026_27: 0 })

    const numbers = await Promise.all(
      Array.from({ length: 100 }, () => nextBillNumber(tx, "2026-04-25")),
    )

    expect(new Set(numbers).size).toBe(100)

    const seq = numbers
      .map((n) => Number.parseInt(n.split("/")[2], 10))
      .sort((a, b) => a - b)

    expect(seq).toEqual(Array.from({ length: 100 }, (_, i) => i + 1))
  })
})

describe("commitBill", () => {
  it("rejects lines that specify both productSizeId and miscItemId", async () => {
    await expect(
      commitBill({} as any, {
        operatorId: 1,
        lines: [
          {
            productSizeId: 11,
            miscItemId: 301,
            itemNameSnapshot: "Invalid mixed source line",
            quantity: 1,
          },
        ],
        payments: [{ mode: PaymentMode.CASH, amount: 120 }],
      }),
    ).rejects.toThrow("exactly one of productSizeId or miscItemId")
  })

  it("rejects non-positive payment amounts", async () => {
    const { tx } = createCommitTx(10)

    await expect(
      commitBill(tx, {
        operatorId: 1,
        lines: [{ productSizeId: 11, itemNameSnapshot: "Brand A 750", quantity: 1 }],
        payments: [{ mode: PaymentMode.CASH, amount: 0 }],
      }),
    ).rejects.toThrow("Payment amounts must be greater than zero")
  })

  it("rejects discounts that exceed gross total", async () => {
    const { tx } = createCommitTx(10)

    await expect(
      commitBill(tx, {
        operatorId: 1,
        lines: [{ productSizeId: 11, itemNameSnapshot: "Brand A 750", quantity: 1 }],
        discountTotal: 500,
        payments: [],
      }),
    ).rejects.toThrow("Discount total cannot exceed gross total")
  })

  it("blocks commit when stock would go negative (spec §10 guard)", async () => {
    vi.mocked(getAvailableStock).mockResolvedValue(5)

    const tx = {}

    await expect(
      commitBill(tx as any, {
        operatorId: 1,
        lines: [
          { productSizeId: 11, itemNameSnapshot: "Brand A 750", quantity: 3 },
          { productSizeId: 11, itemNameSnapshot: "Brand A 750", quantity: 3 },
        ],
        payments: [{ mode: PaymentMode.CASH, amount: 720 }],
      }),
    ).rejects.toThrow("Insufficient stock")

    expect(resolveRate).not.toHaveBeenCalled()
  })

  it("splits a mixed-rate clearance line into multiple bill lines", async () => {
    vi.mocked(resolveRate).mockResolvedValue([
      { rate: new Prisma.Decimal("100"), quantity: 3, clearanceBatchId: 77 },
      { rate: new Prisma.Decimal("120"), quantity: 2 },
    ])

    const { tx, createdLines, billCreate } = createCommitTx(41)

    const billId = await commitBill(tx, {
      operatorId: 9,
      lines: [
        {
          productSizeId: 11,
          itemNameSnapshot: "Brand A 750",
          quantity: 5,
          scanMethod: "BARCODE_USB",
        },
        {
          miscItemId: 301,
          itemNameSnapshot: "Cigarette Pack",
          quantity: 2,
        },
      ],
      payments: [{ mode: PaymentMode.CASH, amount: 580 }],
    })

    expect(billId).toBe(501)
    expect(createdLines).toHaveLength(3)
    expect(createdLines.map((line) => line.quantity)).toEqual([3, 2, 2])
    expect(createdLines.map((line) => line.sourceType)).toEqual(["LIQUOR", "LIQUOR", "MISC"])

    const billData = billCreate.mock.calls[0][0].data
    expect(billData.billNumber).toBe("MV/2026-27/00042")
    expect((billData.businessDate as Date).toISOString()).toBe("2026-04-25T00:00:00.000Z")

    expect(applyClearanceSegments).toHaveBeenCalledTimes(1)
    const segments = vi.mocked(applyClearanceSegments).mock.calls[0][1]
    expect(segments).toHaveLength(1)
    expect(segments[0].quantity).toBe(3)
    expect(segments[0].clearanceBatchId).toBe(77)
    expect(segments[0].rate.toString()).toBe("100")
  })
})

describe("settleTab", () => {
  it("rejects settle when bill is not TAB_OPEN", async () => {
    const tx = {
      bill: {
        findUniqueOrThrow: vi.fn(async () => ({
          status: BillStatus.COMMITTED,
          netCollectible: new Prisma.Decimal("300"),
        })),
        update: vi.fn(),
      },
      paymentAllocation: {
        create: vi.fn(),
      },
      auditEvent: {
        create: vi.fn(),
      },
    }

    await expect(
      settleTab(tx as any, {
        billId: 44,
        actorId: 5,
        payments: [{ mode: PaymentMode.CASH, amount: 300 }],
      }),
    ).rejects.toThrow("Cannot settle bill")

    expect(tx.bill.update).not.toHaveBeenCalled()
  })

  it("settles TAB_OPEN bill into COMMITTED with payment rows", async () => {
    const tx = {
      bill: {
        findUniqueOrThrow: vi.fn(async () => ({
          status: BillStatus.TAB_OPEN,
          netCollectible: new Prisma.Decimal("300"),
        })),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      },
      paymentAllocation: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      },
      auditEvent: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      },
    }

    await settleTab(tx as any, {
      billId: 44,
      actorId: 5,
      payments: [
        { mode: PaymentMode.CASH, amount: 100 },
        { mode: PaymentMode.UPI, amount: 200 },
      ],
    })

    expect(tx.bill.update).toHaveBeenCalledWith({
      where: { id: 44 },
      data: { status: BillStatus.COMMITTED },
    })
    expect(tx.paymentAllocation.create).toHaveBeenCalledTimes(2)
  })

  it("rejects settle when payment total mismatches", async () => {
    const tx = {
      bill: {
        findUniqueOrThrow: vi.fn(async () => ({
          status: BillStatus.TAB_OPEN,
          netCollectible: new Prisma.Decimal("300"),
        })),
        update: vi.fn(),
      },
      paymentAllocation: {
        create: vi.fn(),
      },
      auditEvent: {
        create: vi.fn(),
      },
    }

    await expect(
      settleTab(tx as any, {
        billId: 44,
        actorId: 5,
        payments: [{ mode: PaymentMode.CASH, amount: 250 }],
      }),
    ).rejects.toThrow("Payment total mismatch")

    expect(tx.bill.update).not.toHaveBeenCalled()
  })
})

describe("voidBill", () => {
  it("voids committed bill and reverses matched clearance segments", async () => {
    const tx = {
      bill: {
        findUniqueOrThrow: vi.fn(async () => ({
          status: BillStatus.COMMITTED,
          lines: [
            {
              sourceType: "LIQUOR",
              isVoidedLine: false,
              productSizeId: 11,
              quantity: 3,
              unitPrice: new Prisma.Decimal("100"),
            },
            {
              sourceType: "LIQUOR",
              isVoidedLine: false,
              productSizeId: 11,
              quantity: 2,
              unitPrice: new Prisma.Decimal("120"),
            },
          ],
        })),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      },
      productSize: {
        findUniqueOrThrow: vi.fn(async () => ({ sellingPrice: new Prisma.Decimal("120") })),
      },
      clearanceBatch: {
        findFirst: vi.fn(async ({ where }: { where: { clearanceRate: Prisma.Decimal } }) =>
          where.clearanceRate.toString() === "100" ? { id: 901 } : null,
        ),
      },
      auditEvent: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      },
    }

    await voidBill(tx as any, {
      billId: 55,
      actorId: 8,
      reason: "Operator mistake",
    })

    expect(tx.bill.update).toHaveBeenCalledWith({
      where: { id: 55 },
      data: expect.objectContaining({
        status: BillStatus.VOIDED,
        voidedById: 8,
        voidReason: "Operator mistake",
      }),
    })

    expect(reverseClearanceSegments).toHaveBeenCalledWith(tx, [
      {
        rate: new Prisma.Decimal("100"),
        quantity: 3,
        clearanceBatchId: 901,
      },
    ])
  })

  it("rejects voiding non-COMMITTED bill", async () => {
    const tx = {
      bill: {
        findUniqueOrThrow: vi.fn(async () => ({
          status: BillStatus.TAB_OPEN,
          lines: [],
        })),
        update: vi.fn(),
      },
      auditEvent: {
        create: vi.fn(),
      },
    }

    await expect(
      voidBill(tx as any, {
        billId: 56,
        actorId: 8,
        reason: "Should fail",
      }),
    ).rejects.toThrow("Cannot void bill")

    expect(tx.bill.update).not.toHaveBeenCalled()
    expect(reverseClearanceSegments).not.toHaveBeenCalled()
  })
})
