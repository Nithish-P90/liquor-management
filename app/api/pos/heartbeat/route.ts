import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireSession } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [, err] = await requireSession()
  if (err) return err

  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ ok: true, ts: Date.now() })
  } catch {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 503 })
  }
}
