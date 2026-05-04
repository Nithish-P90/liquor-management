import { z } from "zod"

import { requireAdmin } from "@/lib/api-auth"
import { parseQuery, apiError, jsonOk } from "@/lib/api/handler"
import { parseDateParam } from "@/lib/platform/dates"
import { toDateString } from "@/lib/platform/types"
import { prisma } from "@/lib/platform/prisma"
import { getMiscSalesMetrics } from "@/lib/domains/catalog/misc-items"

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function GET(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const query = parseQuery(req, querySchema)
  if (query instanceof Response) return query

  try {
    return jsonOk(
      await getMiscSalesMetrics(prisma, {
        from: toDateString(parseDateParam(query.from)),
        to: toDateString(parseDateParam(query.to)),
      }),
    )
  } catch {
    return apiError("Database error", 500)
  }
}