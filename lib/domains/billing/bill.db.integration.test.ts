import { BillStatus, PaymentMode, Prisma, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { commitBill, nextBillNumber, openTab, settleTab, voidBill } from "@/lib/domains/billing/bill"

// This suite intentionally requires explicit opt-in:
//   RUN_DB_TESTS=true npm test -- lib/bill.db.integration.test.ts
// It also requires DATABASE_URL and DIRECT_URL to point to a reachable Postgres.
const hasDbEnv =
  process.env.RUN_DB_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL && process.env.DIRECT_URL)
const describeDb = hasDbEnv ? describe : describe.skip
const prisma = new PrismaClient()

const ROLLBACK_SENTINEL = "__ROLLBACK_SENTINEL__"

type Fixture = {
  staffId: number
  productId: number
  productSizeId: number
  miscItemId: number
  inventorySessionId: number
  clearanceBatchId: number
}

function uniqueToken(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function withRollback(
  fn: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await fn(tx)
      throw new Error(ROLLBACK_SENTINEL)
    })
  } catch (error) {
    if (!(error instanceof Error) || error.message !== ROLLBACK_SENTINEL) {
      throw error
    }
  }
}

function todayUtcWindow(): { start: Date; end: Date } {
  const day = new Date().toISOString().slice(0, 10)
  const start = new Date(`${day}T00:00:00.000Z`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { start, end }
}

async function createFixture(
  tx: Prisma.TransactionClient,
  token: string,
  openingBottles: number,
): Promise<Fixture> {
  const staff = await tx.staff.create({
    data: {
      name: `${token} Admin`,
      role: "ADMIN",
      active: true,
    },
    select: { id: true },
  })

  const product = await tx.product.create({
    data: {
      itemCode: `${token}_ITEM`,
      name: `${token} Product`,
      category: "BRANDY",
    },
    select: { id: true },
  })

  const productSize = await tx.productSize.create({
    data: {
      productId: product.id,
      sizeMl: 750,
      bottlesPerCase: 12,
      mrp: new Prisma.Decimal("120.00"),
      sellingPrice: new Prisma.Decimal("120.00"),
    },
    select: { id: true },
  })

  const miscItem = await tx.miscItem.create({
    data: {
      name: `${token} Misc`,
      category: "CIGARETTES",
      unit: "pcs",
      price: new Prisma.Decimal("20.00"),
      active: true,
    },
    select: { id: true },
  })

  const { start, end } = todayUtcWindow()
  const session = await tx.inventorySession.create({
    data: {
      periodStart: start,
      periodEnd: end,
      staffId: staff.id,
    },
    select: { id: true },
  })

  await tx.stockEntry.create({
    data: {
      sessionId: session.id,
      productSizeId: productSize.id,
      entryType: "OPENING",
      cases: 0,
      bottles: openingBottles,
      totalBottles: openingBottles,
    },
  })

  const clearanceBatch = await tx.clearanceBatch.create({
    data: {
      productSizeId: productSize.id,
      originalRate: new Prisma.Decimal("120.00"),
      clearanceRate: new Prisma.Decimal("100.00"),
      totalQuantity: 3,
      soldQuantity: 0,
      createdById: staff.id,
      reason: `${token} clearance`,
    },
    select: { id: true },
  })

  return {
    staffId: staff.id,
    productId: product.id,
    productSizeId: productSize.id,
    miscItemId: miscItem.id,
    inventorySessionId: session.id,
    clearanceBatchId: clearanceBatch.id,
  }
}

describeDb("database + business-logic concurrency and edge cases", () => {
  beforeAll(async () => {
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it("ensures unique sequential bill numbers under DB concurrency", async () => {
    const businessDate = "2099-04-25"
    const counterKey = "bill_counter_2099_00"

    await prisma.setting.deleteMany({ where: { key: counterKey } })

    try {
      const concurrency = 80
      const numbers = await Promise.all(
        Array.from({ length: concurrency }, () =>
          prisma.$transaction((tx) => nextBillNumber(tx, businessDate)),
        ),
      )

      expect(new Set(numbers).size).toBe(concurrency)

      const seq = numbers
        .map((billNo) => Number.parseInt(billNo.split("/")[2], 10))
        .sort((a, b) => a - b)

      expect(seq).toEqual(Array.from({ length: concurrency }, (_, i) => i + 1))
    } finally {
      await prisma.setting.deleteMany({ where: { key: counterKey } })
    }
  })

  it("runs commit -> void -> open-tab -> settle-tab lifecycle against real Prisma transaction", async () => {
    await withRollback(async (tx) => {
      const token = uniqueToken("BILL_LIFECYCLE")
      const fixture = await createFixture(tx, token, 10)

      const committedBillId = await commitBill(tx, {
        operatorId: fixture.staffId,
        lines: [
          {
            productSizeId: fixture.productSizeId,
            itemNameSnapshot: `${token} Liquor`,
            quantity: 5,
            scanMethod: "BARCODE_USB",
          },
          {
            miscItemId: fixture.miscItemId,
            itemNameSnapshot: `${token} Misc`,
            quantity: 1,
            scanMethod: "MANUAL",
          },
        ],
        payments: [{ mode: PaymentMode.CASH, amount: 560 }],
      })

      const committedBill = await tx.bill.findUniqueOrThrow({
        where: { id: committedBillId },
      })
      expect(committedBill.status).toBe(BillStatus.COMMITTED)

      const committedLines = await tx.billLine.findMany({
        where: { billId: committedBillId },
        orderBy: { lineNo: "asc" },
      })
      expect(committedLines).toHaveLength(3)
      expect(committedLines.map((line) => line.quantity)).toEqual([3, 2, 1])

      const batchAfterCommit = await tx.clearanceBatch.findUniqueOrThrow({
        where: { id: fixture.clearanceBatchId },
      })
      expect(batchAfterCommit.soldQuantity).toBe(3)
      expect(batchAfterCommit.status).toBe("EXHAUSTED")

      await voidBill(tx, {
        billId: committedBillId,
        actorId: fixture.staffId,
        reason: `${token} void`,
      })

      const billAfterVoid = await tx.bill.findUniqueOrThrow({
        where: { id: committedBillId },
      })
      expect(billAfterVoid.status).toBe(BillStatus.VOIDED)

      const batchAfterVoid = await tx.clearanceBatch.findUniqueOrThrow({
        where: { id: fixture.clearanceBatchId },
      })
      expect(batchAfterVoid.soldQuantity).toBe(0)
      expect(batchAfterVoid.status).toBe("ACTIVE")

      const tabBillId = await openTab(tx, {
        operatorId: fixture.staffId,
        lines: [
          {
            productSizeId: fixture.productSizeId,
            itemNameSnapshot: `${token} Liquor`,
            quantity: 1,
            scanMethod: "BARCODE_USB",
          },
          {
            miscItemId: fixture.miscItemId,
            itemNameSnapshot: `${token} Misc`,
            quantity: 1,
            scanMethod: "MANUAL",
          },
        ],
      })

      const tabBillBeforeSettle = await tx.bill.findUniqueOrThrow({
        where: { id: tabBillId },
      })
      expect(tabBillBeforeSettle.status).toBe(BillStatus.TAB_OPEN)

      await settleTab(tx, {
        billId: tabBillId,
        actorId: fixture.staffId,
        payments: [{ mode: PaymentMode.UPI, amount: 140 }],
      })

      const tabBillAfterSettle = await tx.bill.findUniqueOrThrow({
        where: { id: tabBillId },
      })
      expect(tabBillAfterSettle.status).toBe(BillStatus.COMMITTED)

      const tabPayments = await tx.paymentAllocation.findMany({
        where: { billId: tabBillId },
      })
      expect(tabPayments).toHaveLength(1)

      const auditTypes = (
        await tx.auditEvent.findMany({
          where: {
            entity: "Bill",
            entityId: { in: [committedBillId, tabBillId] },
          },
          select: { eventType: true },
        })
      ).map((event) => event.eventType)

      expect(auditTypes).toEqual(
        expect.arrayContaining(["BILL_COMMITTED", "BILL_VOIDED", "TAB_OPENED", "TAB_SETTLED"]),
      )
    })
  })

  it("handles critical edge cases in DB transaction flow", async () => {
    await withRollback(async (tx) => {
      const token = uniqueToken("BILL_EDGE")
      const fixture = await createFixture(tx, token, 2)

      await expect(
        commitBill(tx, {
          operatorId: fixture.staffId,
          lines: [
            {
              productSizeId: fixture.productSizeId,
              miscItemId: fixture.miscItemId,
              itemNameSnapshot: `${token} invalid`,
              quantity: 1,
            },
          ],
          payments: [{ mode: PaymentMode.CASH, amount: 100 }],
        }),
      ).rejects.toThrow("exactly one of productSizeId or miscItemId")

      await expect(
        commitBill(tx, {
          operatorId: fixture.staffId,
          lines: [
            {
              productSizeId: fixture.productSizeId,
              itemNameSnapshot: `${token} liquor`,
              quantity: 1,
            },
          ],
          payments: [{ mode: PaymentMode.CASH, amount: 100 }],
        }),
      ).rejects.toThrow("Payment total mismatch")

      const tabId = await openTab(tx, {
        operatorId: fixture.staffId,
        lines: [
          {
            productSizeId: fixture.productSizeId,
            itemNameSnapshot: `${token} liquor`,
            quantity: 1,
          },
        ],
      })

      await expect(
        settleTab(tx, {
          billId: tabId,
          actorId: fixture.staffId,
          payments: [{ mode: PaymentMode.CASH, amount: 10 }],
        }),
      ).rejects.toThrow("Payment total mismatch")

      const committedBillId = await commitBill(tx, {
        operatorId: fixture.staffId,
        lines: [
          {
            productSizeId: fixture.productSizeId,
            itemNameSnapshot: `${token} liquor`,
            quantity: 1,
          },
        ],
        payments: [{ mode: PaymentMode.CASH, amount: 120 }],
      })

      await expect(
        voidBill(tx, {
          billId: committedBillId,
          actorId: fixture.staffId,
          reason: "   ",
        }),
      ).rejects.toThrow("Void reason is required")
    })
  })
})
