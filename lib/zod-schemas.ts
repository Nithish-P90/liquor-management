import { z } from "zod"

import { DateString, isDateString } from "@/lib/types"

export const zDateString: z.ZodType<DateString, z.ZodTypeDef, string> = z
  .string()
  .refine((value): value is DateString => isDateString(value), {
    message: "Invalid date. Use YYYY-MM-DD",
  })

export const zPositiveInt = z.number().int().positive()

export const zCoercePositiveInt = z.coerce.number().int().positive()

export const zNonNegativeDecimal = z.number().nonnegative()

export const zCoerceNonNegativeDecimal = z.coerce.number().nonnegative()

export const zPaymentMode = z.enum(["CASH", "CARD", "UPI", "CREDIT", "SPLIT", "PENDING"])

export const zScanMethod = z.enum(["BARCODE_USB", "BARCODE_CAMERA", "MANUAL"])

export const zRole = z.enum([
  "ADMIN",
  "CASHIER",
  "SUPPLIER",
  "HELPER",
  "LOADER",
  "COLLECTOR",
  "CLEANER",
  "WATCHMAN",
  "OTHER",
])

export const zCategory = z.enum([
  "BRANDY",
  "WHISKY",
  "RUM",
  "VODKA",
  "GIN",
  "WINE",
  "PREMIX",
  "BEER",
  "BEVERAGE",
  "MISCELLANEOUS",
])

export const zAdjustmentType = z.enum(["BREAKAGE", "RETURN", "THEFT_WRITEOFF", "CORRECTION"])

export function apiError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status })
}
