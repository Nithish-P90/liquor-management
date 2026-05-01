import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { apiError, jsonOk, parseJsonBody, parseQuery, requireApiAuth, withApiError } from "@/lib/api/handler"

vi.mock("@/lib/domains/auth/api-auth", () => ({
  requireSession: vi.fn(async () => ({ id: "1", name: "Admin", role: "ADMIN" })),
  requireAdmin: vi.fn(async () => ({ id: "1", name: "Admin", role: "ADMIN" })),
}))

describe("API handler helpers", () => {
  it("formats JSON success and error responses", async () => {
    await expect(jsonOk({ ok: true }).json()).resolves.toEqual({ ok: true })
    expect(apiError("Nope", 409).status).toBe(409)
  })

  it("parses JSON bodies with zod", async () => {
    const req = new Request("http://test.local/api", {
      method: "POST",
      body: JSON.stringify({ name: "Cash" }),
    })

    const parsed = await parseJsonBody(req, z.object({ name: z.string().min(1) }))
    expect(parsed).toEqual({ name: "Cash" })
  })

  it("returns a response for invalid query input", () => {
    const req = new Request("http://test.local/api?limit=bad")
    const parsed = parseQuery(req, z.object({ limit: z.coerce.number().int() }))

    expect(parsed).toBeInstanceOf(Response)
  })

  it("wraps thrown errors into a 500 response", async () => {
    const res = await withApiError(async () => {
      throw new Error("broken")
    })

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: "broken" })
  })

  it("validates cron bearer tokens", async () => {
    process.env.CRON_SECRET = "secret"
    const req = new Request("http://test.local/api", {
      headers: { authorization: "Bearer secret" },
    })

    await expect(requireApiAuth("cron-secret", req)).resolves.toEqual({ user: null })
  })
})
