import { MiscCategory, Prisma } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"

import { toDateString } from "@/lib/platform/types"
import { createMiscItem, getMiscSalesMetrics, listMiscItems, updateMiscItem } from "./misc-items"

describe("misc item catalog", () => {
  it("creates, lists, and updates misc items", async () => {
    const created: Record<string, unknown> = {}
    const tx = {
      miscItem: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(created, data)
          return { id: 1, ...data }
        }),
        findMany: vi.fn(async () => [{ id: 1, name: "Cigarettes", category: MiscCategory.CIGARETTES }]),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 1, ...data })),
      },
    }

    await createMiscItem(tx as never, {
      name: "Cigarettes",
      category: MiscCategory.CIGARETTES,
      unit: "pack",
      price: new Prisma.Decimal("20"),
      barcode: "ABC123",
      active: true,
      isThirdParty: true,
    })

    const items = await listMiscItems(tx as never)
    const updated = await updateMiscItem(tx as never, 1, {
      name: "Cigarettes 10s",
      category: MiscCategory.CIGARETTES,
      unit: "pack",
      price: 25,
      barcode: null,
      active: false,
      isThirdParty: true,
    })

    expect(created.name).toBe("Cigarettes")
    expect(items).toHaveLength(1)
    expect(updated.name).toBe("Cigarettes 10s")
  })

  it("aggregates misc sales metrics from bill lines", async () => {
    const tx = {
      billLine: {
        findMany: vi.fn(async () => [
          {
            billId: 1,
            miscItemId: 101,
            itemNameSnapshot: "Cigarettes",
            quantity: 2,
            lineTotal: new Prisma.Decimal("40"),
            isThirdPartySnapshot: true,
            miscItem: { name: "Cigarettes", category: MiscCategory.CIGARETTES, unit: "pack" },
          },
          {
            billId: 2,
            miscItemId: 102,
            itemNameSnapshot: "Snacks",
            quantity: 3,
            lineTotal: new Prisma.Decimal("60"),
            isThirdPartySnapshot: false,
            miscItem: { name: "Snacks", category: MiscCategory.SNACKS, unit: "pcs" },
          },
        ]),
      },
    }

    const metrics = await getMiscSalesMetrics(tx as never, {
      from: toDateString(new Date("2026-05-01T00:00:00Z")),
      to: toDateString(new Date("2026-05-03T00:00:00Z")),
    })

    expect(metrics.billCount).toBe(2)
    expect(metrics.quantity).toBe(5)
    expect(metrics.grossRevenue).toBe(100)
    expect(metrics.thirdPartyRevenue).toBe(40)
    expect(metrics.ownerRevenue).toBe(60)
    expect(metrics.items[0]).toEqual(
      expect.objectContaining({ miscItemId: 102, itemName: "Snacks", quantity: 3, grossRevenue: 60 }),
    )
  })
})