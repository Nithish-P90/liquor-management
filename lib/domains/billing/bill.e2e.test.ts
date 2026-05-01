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

import { commitBill, openTab, settleTab, voidBill } from "@/lib/domains/billing/bill"
import { getAvailableStock, type PrismaTransactionClient } from "@/lib/domains/inventory/stock"

type FakeState = {
  settings: Map<string, string>
  bills: Array<Record<string, unknown>>
  billLines: Array<Record<string, unknown>>
  paymentAllocations: Array<Record<string, unknown>>
  auditEvents: Array<Record<string, unknown>>
  clearanceBatches: Array<Record<string, unknown>>
}

function sqlKey(sqlArg: unknown): string {
  const values = (sqlArg as { values?: unknown[] } | undefined)?.values
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Missing SQL values")
  }
  return String(values[0])
}

function createFakeTx() {
  const state: FakeState = {
    settings: new Map<string, string>(),
    bills: [],
    billLines: [],
    paymentAllocations: [],
    auditEvents: [],
    clearanceBatches: [
      {
        id: 1,
        productSizeId: 11,
        clearanceRate: new Prisma.Decimal("100"),
        totalQuantity: 3,
        soldQuantity: 0,
        status: "ACTIVE",
        createdAt: new Date("2026-04-24T00:00:00.000Z"),
        exhaustedAt: null,
      },
    ],
  }

  const productSizes = new Map<number, { sellingPrice: Prisma.Decimal }>([
    [11, { sellingPrice: new Prisma.Decimal("120") }],
  ])

  const miscItems = new Map<number, { price: Prisma.Decimal }>([
    [501, { price: new Prisma.Decimal("20") }],
  ])

  let billId = 1
  let billLineId = 1
  let paymentId = 1

  const tx = {
    $queryRaw: vi.fn(async (arg: unknown) => {
      const key = sqlKey(arg)
      const current = state.settings.get(key)
      if (!current) {
        return []
      }

      const next = String(Number.parseInt(current, 10) + 1)
      state.settings.set(key, next)
      return [{ value: next }]
    }),

    setting: {
      create: vi.fn(async ({ data }: { data: { key: string; value: string } }) => {
        if (state.settings.has(data.key)) {
          const error = new Error("Duplicate key") as Error & { code?: string }
          error.code = "P2002"
          throw error
        }

        state.settings.set(data.key, data.value)
        return { id: state.settings.size, ...data }
      }),
    },

    miscItem: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: number } }) => {
        const item = miscItems.get(where.id)
        if (!item) {
          throw new Error(`Missing miscItem ${where.id}`)
        }
        return { price: item.price }
      }),
    },

    productSize: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: number } }) => {
        const size = productSizes.get(where.id)
        if (!size) {
          throw new Error(`Missing productSize ${where.id}`)
        }
        return { sellingPrice: size.sellingPrice }
      }),
    },

    clearanceBatch: {
      findMany: vi.fn(async ({ where }: { where: { productSizeId: number; status: string } }) => {
        return state.clearanceBatches
          .filter(
            (batch) =>
              batch.productSizeId === where.productSizeId &&
              batch.status === where.status,
          )
          .sort((a, b) => {
            const aTs = (a.createdAt as Date).getTime()
            const bTs = (b.createdAt as Date).getTime()
            return aTs - bTs
          })
      }),

      update: vi.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const batch = state.clearanceBatches.find((item) => item.id === where.id)
        if (!batch) {
          throw new Error(`Missing clearanceBatch ${where.id}`)
        }

        const soldQuantityPatch = data.soldQuantity as { increment?: number; decrement?: number } | undefined
        if (soldQuantityPatch?.increment != null) {
          batch.soldQuantity = (batch.soldQuantity as number) + soldQuantityPatch.increment
        }
        if (soldQuantityPatch?.decrement != null) {
          batch.soldQuantity = (batch.soldQuantity as number) - soldQuantityPatch.decrement
        }

        if (Object.prototype.hasOwnProperty.call(data, "status")) {
          batch.status = data.status as string
        }
        if (Object.prototype.hasOwnProperty.call(data, "exhaustedAt")) {
          batch.exhaustedAt = data.exhaustedAt as Date | null
        }

        return { ...batch }
      }),

      findFirst: vi.fn(async ({ where }: { where: { productSizeId: number; clearanceRate: Prisma.Decimal; status: { in: string[] } } }) => {
        return (
          state.clearanceBatches
            .filter((batch) => {
              if (batch.productSizeId !== where.productSizeId) return false
              if (!where.status.in.includes(batch.status as string)) return false
              const rate = batch.clearanceRate as Prisma.Decimal
              return rate.equals(where.clearanceRate)
            })
            .sort((a, b) => {
              const aTs = (a.createdAt as Date).getTime()
              const bTs = (b.createdAt as Date).getTime()
              return aTs - bTs
            })[0] ?? null
        )
      }),
    },

    bill: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const record = { id: billId++, ...data }
        state.bills.push(record)
        return record
      }),

      findUniqueOrThrow: vi.fn(async ({ where, include, select }: { where: { id: number }; include?: { lines?: boolean }; select?: Record<string, boolean> }) => {
        const bill = state.bills.find((record) => record.id === where.id)
        if (!bill) {
          throw new Error(`Missing bill ${where.id}`)
        }

        if (include?.lines) {
          return {
            ...bill,
            lines: state.billLines.filter((line) => line.billId === where.id),
          }
        }

        if (select) {
          const selected: Record<string, unknown> = {}
          Object.keys(select).forEach((key) => {
            if (select[key]) {
              selected[key] = bill[key]
            }
          })
          return selected
        }

        return bill
      }),

      update: vi.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const bill = state.bills.find((record) => record.id === where.id)
        if (!bill) {
          throw new Error(`Missing bill ${where.id}`)
        }
        Object.assign(bill, data)
        return bill
      }),
    },

    billLine: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const record = { id: billLineId++, isVoidedLine: false, ...data }
        state.billLines.push(record)
        return record
      }),
    },

    paymentAllocation: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const record = { id: paymentId++, ...data }
        state.paymentAllocations.push(record)
        return record
      }),
    },

    auditEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.auditEvents.push(data)
        return data
      }),
    },
  }

  return { tx: tx as unknown as PrismaTransactionClient, state }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAvailableStock).mockResolvedValue(100)
})

describe("bill flow end-to-end", () => {
  it("runs commit -> void -> openTab -> settleTab with correct side effects", async () => {
    const { tx, state } = createFakeTx()

    const committedBillId = await commitBill(tx, {
      operatorId: 10,
      lines: [
        {
          productSizeId: 11,
          itemNameSnapshot: "Brandy 750",
          quantity: 5,
          scanMethod: "BARCODE_USB",
        },
        {
          miscItemId: 501,
          itemNameSnapshot: "Cigarette",
          quantity: 2,
          scanMethod: "MANUAL",
        },
      ],
      payments: [{ mode: PaymentMode.CASH, amount: 580 }],
    })

    const committedBill = state.bills.find((bill) => bill.id === committedBillId)
    expect(committedBill?.status).toBe(BillStatus.COMMITTED)
    expect(committedBill?.billNumber).toBe("MV/2026-27/00001")

    const firstBatch = state.clearanceBatches[0]
    expect(firstBatch.soldQuantity).toBe(3)
    expect(firstBatch.status).toBe("EXHAUSTED")

    await voidBill(tx, {
      billId: committedBillId,
      actorId: 99,
      reason: "End-to-end reversal",
    })

    expect(committedBill?.status).toBe(BillStatus.VOIDED)
    expect(firstBatch.soldQuantity).toBe(0)
    expect(firstBatch.status).toBe("ACTIVE")

    const tabBillId = await openTab(tx, {
      operatorId: 10,
      lines: [
        {
          productSizeId: 11,
          itemNameSnapshot: "Brandy 750",
          quantity: 1,
          scanMethod: "BARCODE_USB",
        },
        {
          miscItemId: 501,
          itemNameSnapshot: "Cigarette",
          quantity: 1,
          scanMethod: "MANUAL",
        },
      ],
    })

    const tabBill = state.bills.find((bill) => bill.id === tabBillId)
    expect(tabBill?.status).toBe(BillStatus.TAB_OPEN)
    expect(tabBill?.billNumber).toBe("MV/2026-27/00002")
    // clearance rate (100) + misc (20) = 120, not sellingPrice (120) + misc (20) = 140
    expect(tabBill?.netCollectible?.toString()).toBe("120")
    expect(firstBatch.soldQuantity).toBe(1)
    expect(firstBatch.status).toBe("ACTIVE")

    await settleTab(tx, {
      billId: tabBillId,
      actorId: 10,
      payments: [{ mode: PaymentMode.UPI, amount: 120 }],
    })

    expect(tabBill?.status).toBe(BillStatus.COMMITTED)
    expect(state.paymentAllocations.filter((entry) => entry.billId === tabBillId)).toHaveLength(1)

    const eventTypes = state.auditEvents.map((event) => event.eventType)
    expect(eventTypes).toEqual(
      expect.arrayContaining(["BILL_COMMITTED", "BILL_VOIDED", "TAB_OPENED", "TAB_SETTLED"]),
    )
  })

  it("blocks commit when requested liquor quantity exceeds available stock", async () => {
    const { tx } = createFakeTx()
    vi.mocked(getAvailableStock).mockResolvedValueOnce(2)

    await expect(
      commitBill(tx, {
        operatorId: 10,
        lines: [
          {
            productSizeId: 11,
            itemNameSnapshot: "Brandy 750",
            quantity: 3,
            scanMethod: "BARCODE_USB",
          },
        ],
        payments: [{ mode: PaymentMode.CASH, amount: 360 }],
      }),
    ).rejects.toThrow("Insufficient stock")
  })
})
