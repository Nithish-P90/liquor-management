/**
 * GET /api/sync/heartbeat
 * Lightweight ping for the Windows app to check connectivity.
 * Also validates the Bearer token so the app knows the connection is authenticated.
 */
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function validateToken(req: NextRequest): boolean {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  const expected = process.env.SYNC_TOKEN
  if (!expected) {
    console.warn('[sync] SYNC_TOKEN not set in environment')
    return false
  }
  return token === expected
}

export async function GET(req: NextRequest) {
  if (!validateToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, ts: Date.now() })
}
