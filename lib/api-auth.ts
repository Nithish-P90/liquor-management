import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from './auth'
import crypto from 'crypto'

type SessionUser = {
  id?: string
  name?: string
  role?: string
}

/**
 * Require an authenticated session. Returns the session or a 401 response.
 * Use: const [session, errorRes] = await requireSession()
 *      if (errorRes) return errorRes
 */
export async function requireSession(): Promise<
  [{ user: SessionUser }, null] | [null, NextResponse]
> {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return [null, NextResponse.json({ error: 'Unauthorized' }, { status: 401 })]
  }
  return [{ user: session.user as SessionUser }, null]
}

/**
 * Require an ADMIN session. Returns the session or a 401/403 response.
 */
export async function requireAdmin(): Promise<
  [{ user: SessionUser }, null] | [null, NextResponse]
> {
  const [session, err] = await requireSession()
  if (err) return [null, err]
  if (session.user.role !== 'ADMIN') {
    return [null, NextResponse.json({ error: 'Forbidden' }, { status: 403 })]
  }
  return [session, null]
}

/**
 * Validate a Bearer token against an env variable using constant-time comparison.
 * Prevents timing attacks.
 */
export function validateBearerToken(
  authHeader: string | null,
  envKey: string
): boolean {
  const expected = process.env[envKey]
  if (!expected) return false

  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader ?? ''

  if (token.length !== expected.length) return false

  try {
    return crypto.timingSafeEqual(
      Buffer.from(token, 'utf8'),
      Buffer.from(expected, 'utf8')
    )
  } catch {
    return false
  }
}
