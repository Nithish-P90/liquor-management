export function toUtcNoonDate(value?: Date | string): Date {
  const d = value ? new Date(value) : new Date()
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0))
}

export function subtractDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() - days)
  return d
}
