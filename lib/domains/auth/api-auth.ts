import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/domains/auth/auth"

export type SessionUser = {
  id: string
  name: string
  role: "ADMIN" | "CASHIER"
}

function unauthorizedResponse(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 })
}

function forbiddenResponse(): Response {
  return Response.json({ error: "Forbidden" }, { status: 403 })
}

export async function requireSession(): Promise<SessionUser | Response> {
  const session = await getServerSession(authOptions)

  if (!session?.user || !session.user.id || !session.user.name || !session.user.role) {
    return unauthorizedResponse()
  }

  return {
    id: session.user.id,
    name: session.user.name,
    role: session.user.role,
  }
}

export async function requireAdmin(): Promise<SessionUser | Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  if (authResult.role !== "ADMIN") {
    return forbiddenResponse()
  }

  return authResult
}

export async function requireRole(
  roles: Array<"ADMIN" | "CASHIER">,
): Promise<SessionUser | Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  if (!roles.includes(authResult.role)) {
    return forbiddenResponse()
  }

  return authResult
}
