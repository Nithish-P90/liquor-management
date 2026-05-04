import { z } from "zod"

import { requireApiAuth } from "@/lib/api/handler"
import { parseJsonBody, jsonOk, apiError } from "@/lib/api/handler"
import { setInitialOpeningStock } from "@/lib/domains/inventory/stock-entry"
import { getOpeningStockSnapshot, replaceOpeningStockSnapshot } from "@/lib/domains/inventory/opening-stock"

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        productSizeId: z.number().int().positive(),
        cases: z.number().int().nonnegative(),
        bottles: z.number().int().nonnegative(),
      }),
    )
    .min(1),
})

const querySchema = z.object({
  sessionId: z.coerce.number().int().positive(),
})

export async function GET(req: Request): Promise<Response> {
  const authResult = await requireApiAuth("session", req)
  if (authResult instanceof Response) return authResult

  const url = new URL(req.url)
  const queryOrError = querySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!queryOrError.success) {
    return apiError(queryOrError.error.issues[0]?.message ?? "Invalid query")
  }

  try {
    const snapshot = await getOpeningStockSnapshot(queryOrError.data.sessionId)
    if (!snapshot) {
      return apiError("Inventory session not found", 404)
    }

    return jsonOk(snapshot)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Failed to fetch opening stock", 500)
  }
}

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireApiAuth("admin", req)
  if (authResult instanceof Response) return authResult

  const bodyOrError = await parseJsonBody(req, bodySchema)
  if (bodyOrError instanceof Response) return bodyOrError

  const { items } = bodyOrError

  try {
    const userId = authResult.user?.id
    if (!userId || typeof userId !== "string") {
      return apiError("Invalid user ID", 401)
    }

    const staffId = parseInt(userId, 10)
    if (isNaN(staffId)) {
      return apiError("Invalid staff ID", 401)
    }

    const result = await setInitialOpeningStock({ staffId, items })
    return jsonOk(result, { status: 201 })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Failed to set opening stock", 400)
  }
}

export async function PATCH(req: Request): Promise<Response> {
  const authResult = await requireApiAuth("admin", req)
  if (authResult instanceof Response) return authResult

  const url = new URL(req.url)
  const queryOrError = querySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!queryOrError.success) {
    return apiError(queryOrError.error.issues[0]?.message ?? "Invalid query")
  }

  const bodyOrError = await parseJsonBody(req, bodySchema)
  if (bodyOrError instanceof Response) return bodyOrError

  try {
    const result = await replaceOpeningStockSnapshot(queryOrError.data.sessionId, bodyOrError.items)
    return jsonOk(result)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Failed to update opening stock", 400)
  }
}
