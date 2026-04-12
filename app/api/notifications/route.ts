import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const notifications = await prisma.notification.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return NextResponse.json(notifications)
}

export async function PATCH(req: NextRequest) {
  // Mark notifications as read
  const { ids } = await req.json()
  await prisma.notification.updateMany({
    where: { id: { in: ids } },
    data: { read: true },
  })
  return NextResponse.json({ ok: true })
}
