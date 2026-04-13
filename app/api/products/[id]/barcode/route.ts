import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { barcode } = await req.json()
  const ps = await prisma.productSize.update({
    where: { id: parseInt(params.id) },
    data: { barcode: barcode || null },
  })
  return NextResponse.json(ps)
}
