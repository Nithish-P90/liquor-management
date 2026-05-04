import { prisma } from "@/lib/platform/prisma"

// Weekend policy: Fri, Sat, Sun cannot be missed (Mon=0 system)
const WEEKEND_DAYS = [4, 5, 6] // Fri, Sat, Sun

export type AttendanceMetrics = {
  staffId: number
  name: string
  role: string
  payrollType: string
  monthlySalary: number | null
  dailyWage: number | null
  month: string             // "YYYY-MM"
  workingDaysInMonth: number
  daysPresent: number
  daysAbsent: number
  lateArrivals: number
  earlyDepartures: number
  totalMinutesWorked: number  // sum of (clockOut - clockIn) in minutes
  avgDailyMinutes: number     // totalMinutesWorked / daysPresent
  weekendDaysInMonth: number  // total Fri+Sat+Sun in the month
  weekendDaysPresent: number  // how many policy-weekend days they attended
  weekendDaysMissed: number   // weekendDaysInMonth - weekendDaysPresent (policy violations)
  weekendMissedDates: string[] // YYYY-MM-DD strings for each missed weekend day
  lateIncidents: Array<{ date: string; shiftStart: string; arrivedAt: string; minutesLate: number }>
  earlyExitIncidents: Array<{ date: string; shiftEnd: string; leftAt: string; minutesEarly: number }>
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function dayOfWeekMonday0(d: Date): number {
  return (d.getDay() + 6) % 7
}

function workingDaysCount(year: number, month: number): number {
  // Mon–Sat (exclude Sunday) — Sunday is day 0 in JS, which is 6 in Mon=0
  const end = new Date(year, month, 0)
  let count = 0
  for (let d = new Date(year, month - 1, 1); d <= end; d.setDate(d.getDate() + 1)) {
    if (dayOfWeekMonday0(d) !== 6) count++ // exclude Sunday
  }
  return count
}

function weekendDatesInMonth(year: number, month: number): string[] {
  const end = new Date(year, month, 0)
  const dates: string[] = []
  for (let d = new Date(year, month - 1, 1); d <= end; d.setDate(d.getDate() + 1)) {
    if (WEEKEND_DAYS.includes(dayOfWeekMonday0(d))) {
      dates.push(toDateStr(d))
    }
  }
  return dates
}

export async function attendanceMetrics(opts: {
  month: string  // "YYYY-MM"
  staffId?: number
}): Promise<AttendanceMetrics[]> {
  const [yearStr, monthStr] = opts.month.split("-")
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)

  const from = new Date(year, month - 1, 1)
  const to = new Date(year, month, 0, 23, 59, 59, 999)

  const workingDays = workingDaysCount(year, month)
  const allWeekendDates = weekendDatesInMonth(year, month)

  const staffWhere = opts.staffId ? { id: opts.staffId, active: true } : { active: true }

  const staff = await prisma.staff.findMany({
    where: staffWhere,
    select: {
      id: true,
      name: true,
      role: true,
      payrollType: true,
      monthlySalary: true,
      dailyWage: true,
      attendanceEvents: {
        where: { occurredAt: { gte: from, lte: to } },
        select: {
          eventType: true,
          occurredAt: true,
          isLate: true,
          isEarlyDeparture: true,
          shiftStart: true,
          shiftEnd: true,
        },
        orderBy: { occurredAt: "asc" },
      },
    },
    orderBy: { name: "asc" },
  })

  return staff.map((s) => {
    type DayPair = { clockIn?: Date; clockOut?: Date; isLate: boolean; isEarlyDep: boolean; shiftStart?: Date; shiftEnd?: Date }
    const byDate = new Map<string, DayPair>()

    for (const ev of s.attendanceEvents) {
      const dateKey = toDateStr(ev.occurredAt)
      const existing = byDate.get(dateKey) ?? { isLate: false, isEarlyDep: false }
      if (ev.eventType === "CLOCK_IN") {
        byDate.set(dateKey, {
          ...existing,
          clockIn: ev.occurredAt,
          isLate: ev.isLate,
          shiftStart: ev.shiftStart ?? undefined,
        })
      } else {
        byDate.set(dateKey, {
          ...existing,
          clockOut: ev.occurredAt,
          isEarlyDep: ev.isEarlyDeparture,
          shiftEnd: ev.shiftEnd ?? undefined,
        })
      }
    }

    const days = Array.from(byDate.entries())
    const daysPresent = days.filter(([, d]) => d.clockIn !== undefined).length
    const presentDates = new Set(days.filter(([, d]) => d.clockIn !== undefined).map(([date]) => date))

    const lateIncidents: AttendanceMetrics["lateIncidents"] = []
    const earlyExitIncidents: AttendanceMetrics["earlyExitIncidents"] = []
    let totalMinutes = 0

    for (const [date, d] of days) {
      if (d.clockIn && d.clockOut) {
        totalMinutes += (d.clockOut.getTime() - d.clockIn.getTime()) / 60000
      }
      if (d.isLate && d.clockIn && d.shiftStart) {
        const minutesLate = Math.round((d.clockIn.getTime() - d.shiftStart.getTime()) / 60000)
        lateIncidents.push({ date, shiftStart: d.shiftStart.toISOString(), arrivedAt: d.clockIn.toISOString(), minutesLate })
      }
      if (d.isEarlyDep && d.clockOut && d.shiftEnd) {
        const minutesEarly = Math.round((d.shiftEnd.getTime() - d.clockOut.getTime()) / 60000)
        earlyExitIncidents.push({ date, shiftEnd: d.shiftEnd.toISOString(), leftAt: d.clockOut.toISOString(), minutesEarly })
      }
    }

    // Only count past weekend days (don't flag future dates as missed)
    const today = toDateStr(new Date())
    const pastWeekendDates = allWeekendDates.filter((d) => d <= today)
    const weekendMissedDates = pastWeekendDates.filter((d) => !presentDates.has(d))

    return {
      staffId: s.id,
      name: s.name,
      role: s.role,
      payrollType: s.payrollType,
      monthlySalary: s.monthlySalary !== null ? Number(s.monthlySalary) : null,
      dailyWage: s.dailyWage !== null ? Number(s.dailyWage) : null,
      month: opts.month,
      workingDaysInMonth: workingDays,
      daysPresent,
      daysAbsent: Math.max(0, workingDays - daysPresent),
      lateArrivals: lateIncidents.length,
      earlyDepartures: earlyExitIncidents.length,
      totalMinutesWorked: Math.round(totalMinutes),
      avgDailyMinutes: daysPresent > 0 ? Math.round(totalMinutes / daysPresent) : 0,
      weekendDaysInMonth: pastWeekendDates.length,
      weekendDaysPresent: pastWeekendDates.filter((d) => presentDates.has(d)).length,
      weekendDaysMissed: weekendMissedDates.length,
      weekendMissedDates,
      lateIncidents: lateIncidents.sort((a, b) => a.date.localeCompare(b.date)),
      earlyExitIncidents: earlyExitIncidents.sort((a, b) => a.date.localeCompare(b.date)),
    }
  })
}
