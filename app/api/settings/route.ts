import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireSession, requireAdmin } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [, err] = await requireSession()
  if (err) return err

  const settings = await prisma.setting.findMany()
  const obj: Record<string, string> = {}
  settings.forEach(s => { obj[s.key] = s.value })
  return NextResponse.json(obj)
}

export async function POST(req: NextRequest) {
  const [, err] = await requireAdmin()
  if (err) return err

  const body = await req.json()

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be a key-value object' }, { status: 400 })
  }

  const entries = Object.entries(body)
  if (entries.length === 0 || entries.length > 50) {
    return NextResponse.json({ error: 'Provide 1-50 settings' }, { status: 400 })
  }

  await Promise.all(
    entries.map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      })
    )
  )
  return NextResponse.json({ ok: true })
}
