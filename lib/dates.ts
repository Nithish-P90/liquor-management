import { DateString, isDateString, toDateString } from "@/lib/types"

export function parseDateParam(s: string): Date {
  if (!isDateString(s)) {
    throw new Error("Invalid date format. Expected YYYY-MM-DD")
  }
  const [year, month, day] = s.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

export function todayDateString(): DateString {
  return toDateString(new Date())
}

export function subtractDays(s: DateString, n: number): DateString {
  const dt = parseDateParam(s)
  dt.setUTCDate(dt.getUTCDate() - n)
  return toDateString(dt)
}

export function addDays(s: DateString, n: number): DateString {
  const dt = parseDateParam(s)
  dt.setUTCDate(dt.getUTCDate() + n)
  return toDateString(dt)
}

export function fmtDMY(s: DateString): string {
  const [year, month, day] = s.split("-")
  return `${day}/${month}/${year}`
}

export function fmtTime(dt: Date | string): string {
  const date = dt instanceof Date ? dt : new Date(dt)
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(date)
}
