import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireSession, requireAdmin } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const [, err] = await requireSession()
  if (err) return err
  const { searchParams } = new URL(req.url)
  const resolved = searchParams.get('resolved') === 'true'

  const alerts = await prisma.varianceRecord.findMany({
    where: { resolved, severity: { not: 'OK' } },
    include: { productSize: { include: { product: true } } },
    orderBy: [{ severity: 'desc' }, { recordDate: 'desc' }],
  })
  return NextResponse.json(alerts)
}

export async function PATCH(req: NextRequest) {
  const [, err] = await requireAdmin()
  if (err) return err

  const body = await req.json()
  const { id, resolvedNote } = body

  const record = await prisma.varianceRecord.update({
    where: { id },
    data: { resolved: true, resolvedNote },
  })
  return NextResponse.json(record)
}
