import { z } from "zod"
import { requireApiAuth, parseQuery, jsonOk, withApiError } from "@/lib/api/handler"
import { thirdPartyPayoutSummary } from "@/lib/domains/billing/third-party-ledger"

const zQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
})

export async function GET(req: Request): Promise<Response> {
  const auth = await requireApiAuth("admin", req)
  if (auth instanceof Response) return auth

  const query = parseQuery(req, zQuery)
  if (query instanceof Response) return query

  return withApiError(async () => {
    const result = await thirdPartyPayoutSummary({
      from: new Date(query.from),
      to: new Date(query.to),
    })
    return jsonOk(result)
  })
}
