import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const settings = await prisma.setting.findMany()
  const obj: Record<string, string> = {}
  settings.forEach(s => { obj[s.key] = s.value })
  return NextResponse.json(obj)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  await Promise.all(
    Object.entries(body).map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      })
    )
  )
  return NextResponse.json({ ok: true })
}
