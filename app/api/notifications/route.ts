import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireSession } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [, err] = await requireSession()
  if (err) return err

  const notifications = await prisma.notification.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return NextResponse.json(notifications)
}

export async function PATCH(req: NextRequest) {
  const [, err] = await requireSession()
  if (err) return err

  const { ids } = await req.json()
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'number')) {
    return NextResponse.json({ error: 'ids must be an array of numbers' }, { status: 400 })
  }

  await prisma.notification.updateMany({
    where: { id: { in: ids } },
    data: { read: true },
  })
  return NextResponse.json({ ok: true })
}
