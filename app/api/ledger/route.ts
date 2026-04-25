import { z } from "zod"

import { requireAdmin } from "@/lib/api-auth"
import {
  getAuditLog,
  getBillLines,
  getClerkPerformance,
  getExpensesSummary,
  getSalesSummary,
  getTopSellers,
  getVoidedBills,
} from "@/lib/ledger"
import { apiError, zDateString } from "@/lib/zod-schemas"

const querySchema = z.object({
  from: zDateString,
  to: zDateString,
  view: z.enum(["summary", "bills", "voids", "expenses", "top-sellers", "clerks", "audit"]).default("summary"),
  limit: z.coerce.number().int().positive().max(500).default(200),
})

export async function GET(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const url = new URL(req.url)
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid query")

  const { from, to, view, limit } = parsed.data
  const range = { from, to }

  try {
    switch (view) {
      case "summary":
        return Response.json(await getSalesSummary(range))
      case "bills":
        return Response.json(await getBillLines(range, limit))
      case "voids":
        return Response.json(await getVoidedBills(range))
      case "expenses":
        return Response.json(await getExpensesSummary(range))
      case "top-sellers":
        return Response.json(await getTopSellers(range, limit))
      case "clerks":
        return Response.json(await getClerkPerformance(range))
      case "audit":
        return Response.json(await getAuditLog(range, limit))
      default:
        return apiError("Invalid view")
    }
  } catch {
    return apiError("Database error", 500)
  }
}
