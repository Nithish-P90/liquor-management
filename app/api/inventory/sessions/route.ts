import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET() {
  const sessions = await prisma.inventorySession.findMany({
    include: { createdBy: { select: { name: true } } },
    orderBy: { periodStart: 'desc' },
    take: 20,
  })
  return NextResponse.json(sessions)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { periodStart, periodEnd } = body
  const staffId = parseInt(((session.user as { id?: string } | undefined)?.id) ?? '0')

  const inv = await prisma.inventorySession.create({
    data: {
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      staffId,
    },
  })
  return NextResponse.json(inv)
}
