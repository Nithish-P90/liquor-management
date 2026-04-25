import { AttendanceEventType, AttendanceMethod } from "@prisma/client"

import { prisma } from "@/lib/prisma"

export type PunchResult = {
  eventType: AttendanceEventType
  isLate: boolean
  isEarlyDeparture: boolean
  message: string
}

export async function punch(params: {
  staffId: number
  method: AttendanceMethod
  confidenceScore?: number
  overrideReason?: string
}): Promise<PunchResult> {
  const { staffId, method, confidenceScore, overrideReason } = params

  // Find last event for this staff today
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const lastEvent = await prisma.attendanceEvent.findFirst({
    where: { staffId, occurredAt: { gte: todayStart } },
    orderBy: { occurredAt: "desc" },
  })

  const eventType = !lastEvent || lastEvent.eventType === AttendanceEventType.CLOCK_OUT
    ? AttendanceEventType.CLOCK_IN
    : AttendanceEventType.CLOCK_OUT

  // Get shift template
  const shift = await prisma.shiftTemplate.findFirst({
    where: { staffId, isActive: true },
  })

  const now = new Date()
  let isLate = false
  let isEarlyDeparture = false
  let shiftStart: Date | undefined
  let shiftEnd: Date | undefined

  if (shift) {
    const [startH, startM] = shift.startTime.split(":").map(Number)
    const [endH, endM] = shift.endTime.split(":").map(Number)

    shiftStart = new Date(now)
    shiftStart.setHours(startH, startM, 0, 0)
    shiftEnd = new Date(now)
    shiftEnd.setHours(endH, endM, 0, 0)

    if (eventType === AttendanceEventType.CLOCK_IN) {
      const graceMs = 15 * 60 * 1000
      isLate = now.getTime() > shiftStart.getTime() + graceMs
    } else {
      isEarlyDeparture = now.getTime() < shiftEnd.getTime()
    }
  }

  await prisma.attendanceEvent.create({
    data: {
      staffId,
      eventType,
      method,
      confidenceScore: confidenceScore ?? null,
      isLate,
      isEarlyDeparture,
      shiftStart: shiftStart ?? null,
      shiftEnd: shiftEnd ?? null,
      overrideReason: overrideReason ?? null,
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
}
