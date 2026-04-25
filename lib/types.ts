export type DateString = string & { readonly __brand: "DateString" }

export function toDateString(d: Date): DateString {
  return d.toISOString().slice(0, 10) as DateString
}

export function isDateString(s: string): s is DateString {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export type ApiError = { error: string }
