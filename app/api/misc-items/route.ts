import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

function isAllowedRole(role?: string) {
  return role === 'ADMIN' || role === 'CASHIER'
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string } | undefined
  if (!session || !isAllowedRole(user?.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const barcode = req.nextUrl.searchParams.get('barcode')
  if (!barcode) return NextResponse.json(null)
  const item = await prisma.miscItem.findUnique({ where: { barcode } })
  return NextResponse.json(item)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string } | undefined
  if (!session || !isAllowedRole(user?.role)) {
    return NextResponse.json({ error: 'Only admins and cashiers can add misc items' }, { status: 403 })
  }

  const body = await req.json()

  if (!body?.barcode || !body?.name || !body?.category || body?.price == null) {
    return NextResponse.json({ error: 'barcode, name, category and price are required' }, { status: 400 })
  }

  const item = await prisma.miscItem.create({
    data: {
      barcode: body.barcode,
      name: body.name,
      category: body.category,
      price: body.price,
    },
  })
  return NextResponse.json(item)
}
