import { AttendanceEventType, AttendanceMethod } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

const prismaMock = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/platform/prisma", () => prismaMock)

import { punch } from "./attendance"

function buildTx(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    attendanceEvent: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
    },
    staff: {
      findUnique: vi.fn(async () => ({ lateGraceMinutes: 15 })),
    },
    shiftTemplate: {
      findFirst: vi.fn(async () => null),
    },
    ...overrides,
  }
}

describe("attendance punch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects a second check-in on the same day", async () => {
    const tx = buildTx({
      attendanceEvent: {
        findUnique: vi.fn(async () => null),
        findMany: vi.fn(async () => [{ eventType: AttendanceEventType.CLOCK_IN }]),
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({})),
      },
    })
    prismaMock.prisma.$transaction.mockImplementation(async (callback: (tx: never) => Promise<unknown>) => callback(tx as never))

    await expect(punch({
      staffId: 11,
      method: AttendanceMethod.FACE,
      eventType: AttendanceEventType.CLOCK_IN,
    })).rejects.toThrow("Already clocked in today")
  })

  it("rejects check-out before a same-day check-in", async () => {
    const tx = buildTx({
      attendanceEvent: {
        findUnique: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({})),
      },
    })
    prismaMock.prisma.$transaction.mockImplementation(async (callback: (tx: never) => Promise<unknown>) => callback(tx as never))

    await expect(punch({
      staffId: 11,
      method: AttendanceMethod.FACE,
      eventType: AttendanceEventType.CLOCK_OUT,
    })).rejects.toThrow("Clock in first")
  })

  it("records a clock-out after a clock-in on the same day", async () => {
    const create = vi.fn(async () => ({}))
    const tx = buildTx({
      attendanceEvent: {
        findUnique: vi.fn(async () => null),
        findMany: vi.fn(async () => [{ eventType: AttendanceEventType.CLOCK_IN }]),
        findFirst: vi.fn(async () => null),
        create,
      },
    })
    prismaMock.prisma.$transaction.mockImplementation(async (callback: (tx: never) => Promise<unknown>) => callback(tx as never))

    const result = await punch({
      staffId: 11,
      method: AttendanceMethod.FACE,
      eventType: AttendanceEventType.CLOCK_OUT,
    })

    expect(result.eventType).toBe(AttendanceEventType.CLOCK_OUT)
    expect(create).toHaveBeenCalledTimes(1)
  })
})