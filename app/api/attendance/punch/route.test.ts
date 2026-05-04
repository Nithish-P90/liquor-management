import { beforeEach, describe, expect, it, vi } from "vitest"

const authMock = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireAdmin: vi.fn(),
}))

const punchMock = vi.hoisted(() => ({
  punch: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => authMock)
vi.mock("@/lib/attendance", () => punchMock)

import { POST } from "./route"

describe("attendance punch route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects manual overrides for non-admin users", async () => {
    authMock.requireAdmin.mockResolvedValue(Response.json({ error: "Forbidden" }, { status: 403 }))

    const response = await POST(new Request("http://localhost/api/attendance/punch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffId: 3, method: "MANUAL_OVERRIDE", eventType: "CLOCK_IN" }),
    }))

    expect(response.status).toBe(403)
    expect(punchMock.punch).not.toHaveBeenCalled()
  })

  it("forwards explicit face punches to the domain", async () => {
    authMock.requireSession.mockResolvedValue({ id: "1", name: "Admin", role: "ADMIN" })
    punchMock.punch.mockResolvedValue({
      eventType: "CLOCK_IN",
      isLate: false,
      isEarlyDeparture: false,
      message: "Clocked in",
    })

    const response = await POST(new Request("http://localhost/api/attendance/punch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffId: 3, method: "FACE", eventType: "CLOCK_IN", confidenceScore: 0.93 }),
    }))

    expect(response.status).toBe(200)
    expect(punchMock.punch).toHaveBeenCalledWith(expect.objectContaining({
      staffId: 3,
      method: "FACE",
      eventType: "CLOCK_IN",
      confidenceScore: 0.93,
    }))
  })
})