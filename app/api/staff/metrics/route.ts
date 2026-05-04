import { z } from "zod"
import { requireApiAuth, parseQuery, jsonOk, withApiError } from "@/lib/api/handler"
import { staffMetrics } from "@/lib/domains/staff/metrics"

const zQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export async function GET(req: Request): Promise<Response> {
  const auth = await requireApiAuth("admin", req)
  if (auth instanceof Response) return auth

  const query = parseQuery(req, zQuery)
  if (query instanceof Response) return query

  return withApiError(async () => {
    const range = query.from && query.to
      ? { from: new Date(query.from), to: new Date(query.to) }
      : undefined
    const result = await staffMetrics(range)
    return jsonOk(result)
  })
}
