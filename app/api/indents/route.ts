export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const indents = await prisma.indent.findMany({
    include: { items: { include: { product: true, productSize: true } }, receipts: true },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(indents)
}
