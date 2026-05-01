import { AttendanceEventType, AttendanceMethod } from "@prisma/client"

import { prisma } from "@/lib/platform/prisma"

export type PunchResult = {
  eventType: AttendanceEventType
  isLate: boolean
  isEarlyDeparture: boolean
  message: string
}

const DEDUPE_WINDOW_MS = 30_000

function parseTimeHHmm(time: string): { h: number; m: number } {
  const [hStr, mStr] = time.split(":")
  const h = Number(hStr)
  const m = Number(mStr)
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 }
}

function dayOfWeekMonday0(d: Date): number {
  // JS: 0=Sun..6=Sat. We store activeDays as Int[]; treat 0=Mon..6=Sun.
  const js = d.getDay()
  return (js + 6) % 7
}

export async function punch(params: {
  staffId: number
  method: AttendanceMethod
  confidenceScore?: number
  overrideReason?: string
  requestId?: string
  deviceLabel?: string
  ipAddress?: string
  userAgent?: string
}): Promise<PunchResult> {
  const { staffId, method, confidenceScore, overrideReason, requestId, deviceLabel, ipAddress, userAgent } = params
  const now = new Date()

  return prisma.$transaction(async (tx) => {
    if (requestId) {
      const existing = await tx.attendanceEvent.findUnique({
        where: { requestId },
        select: { eventType: true, isLate: true, isEarlyDeparture: true },
      })
      if (existing) {
        return {
          eventType: existing.eventType,
          isLate: existing.isLate,
          isEarlyDeparture: existing.isEarlyDeparture,
          message: "Already recorded",
        }
      }
    }

    const staff = await tx.staff.findUnique({
      where: { id: staffId },
      select: { lateGraceMinutes: true },
    })
    if (!staff) throw new Error("Staff not found")

    // Find last event (recent) for dedupe, then decide toggle direction.
    const lastEvent = await tx.attendanceEvent.findFirst({
      where: { staffId },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true, eventType: true },
    })

    if (lastEvent && now.getTime() - lastEvent.occurredAt.getTime() < DEDUPE_WINDOW_MS) {
      return {
        eventType: lastEvent.eventType,
        isLate: false,
        isEarlyDeparture: false,
        message: "Punch ignored (too soon). Please wait a moment.",
      }
    }

    const eventType = !lastEvent || lastEvent.eventType === AttendanceEventType.CLOCK_OUT
      ? AttendanceEventType.CLOCK_IN
      : AttendanceEventType.CLOCK_OUT

    // Pick an applicable shift: today's shift, or previous-day shift if overnight.
    const activeShift = await tx.shiftTemplate.findFirst({
      where: { staffId, isActive: true },
      orderBy: { id: "desc" },
      select: { startTime: true, endTime: true, activeDays: true },
    })

    let isLate = false
    let isEarlyDeparture = false
    let shiftStart: Date | undefined
    let shiftEnd: Date | undefined

    if (activeShift && Array.isArray(activeShift.activeDays) && activeShift.activeDays.length > 0) {
      const { h: startH, m: startM } = parseTimeHHmm(activeShift.startTime)
      const { h: endH, m: endM } = parseTimeHHmm(activeShift.endTime)
      const overnight = endH * 60 + endM <= startH * 60 + startM

      const todayDow = dayOfWeekMonday0(now)
      const yesterday = new Date(now)
      yesterday.setDate(now.getDate() - 1)
      const yDow = dayOfWeekMonday0(yesterday)

      const canUseToday = activeShift.activeDays.includes(todayDow)
      const canUseYesterday = overnight && activeShift.activeDays.includes(yDow)

      const base = canUseToday ? new Date(now) : canUseYesterday ? yesterday : null
      if (base) {
        shiftStart = new Date(base)
        shiftStart.setHours(startH, startM, 0, 0)
        shiftEnd = new Date(base)
        shiftEnd.setHours(endH, endM, 0, 0)
        if (overnight) shiftEnd.setDate(shiftEnd.getDate() + 1)

        if (eventType === AttendanceEventType.CLOCK_IN) {
          const graceMs = (staff.lateGraceMinutes ?? 15) * 60 * 1000
          isLate = now.getTime() > shiftStart.getTime() + graceMs
        } else {
          isEarlyDeparture = now.getTime() < shiftEnd.getTime()
        }
      }
    }

    await tx.attendanceEvent.create({
      data: {
        staffId,
        eventType,
        method,
        requestId: requestId ?? null,
        confidenceScore: confidenceScore ?? null,
        isLate,
        isEarlyDeparture,
        shiftStart: shiftStart ?? null,
        shiftEnd: shiftEnd ?? null,
        overrideReason: overrideReason ?? null,
        deviceLabel: deviceLabel ?? null,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      },
    })

    return {
      eventType,
      isLate,
      isEarlyDeparture,
      message: eventType === AttendanceEventType.CLOCK_IN
        ? isLate ? "Clocked in (LATE)" : "Clocked in"
        : isEarlyDeparture ? "Clocked out (EARLY)" : "Clocked out",
    }
  })
}
