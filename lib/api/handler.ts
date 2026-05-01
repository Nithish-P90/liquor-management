import { z } from "zod"

import type { AuthPolicy } from "@/lib/api/routes"
import { requireAdmin, requireSession, type SessionUser } from "@/lib/domains/auth/api-auth"

export type ApiAuthResult = {
  user: SessionUser | null
}

export function jsonOk<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, init)
}

export function apiError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status })
}

export async function withApiError(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler()
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error"
    return apiError(message, 500)
  }
}

export async function parseJsonBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<T | Response> {
  let body: unknown

  try {
    body = await req.json()
  } catch {
    return apiError("Invalid JSON body")
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid body")
  }

  return parsed.data
}

export function parseQuery<T>(req: Request, schema: z.ZodType<T>): T | Response {
  const url = new URL(req.url)
  const parsed = schema.safeParse(Object.fromEntries(url.searchParams))

  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid query")
  }

  return parsed.data
}

export async function requireApiAuth(
  policy: AuthPolicy,
  req: Request,
): Promise<ApiAuthResult | Response> {
  if (policy === "public-nextauth") {
    return { user: null }
  }

  if (policy === "session") {
    const authResult = await requireSession()
    return authResult instanceof Response ? authResult : { user: authResult }
  }

  if (policy === "admin") {
    const authResult = await requireAdmin()
    return authResult instanceof Response ? authResult : { user: authResult }
  }

  const secret = process.env.CRON_SECRET
  if (!secret) {
    return apiError("CRON_SECRET is not configured", 500)
  }

  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return apiError("Unauthorized", 401)
  }

  return { user: null }
}
