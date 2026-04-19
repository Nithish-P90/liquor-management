import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Category } from '@prisma/client'
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
  if (barcode) {
    const item = await prisma.miscItem.findUnique({ where: { barcode } })
    return NextResponse.json(item)
  }

  // List all misc items
  const items = await prisma.miscItem.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] })
  return NextResponse.json(items)
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string } | undefined
  if (!session || !isAllowedRole(user?.role)) {
    return NextResponse.json({ error: 'Only admins and cashiers can edit misc items' }, { status: 403 })
  }

  const body = await req.json()
  const id = Number(body?.id)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const existing = await prisma.miscItem.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  const name = body?.name !== undefined ? String(body.name).trim() : existing.name
  const category = body?.category !== undefined ? String(body.category).trim() : existing.category
  const price = body?.price !== undefined ? Number(body.price) : Number(existing.price)

  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!Number.isFinite(price) || price <= 0) return NextResponse.json({ error: 'Valid price required' }, { status: 400 })
  if (!['CIGARETTES', 'SNACKS', 'CUPS'].includes(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }

  const updated = await prisma.miscItem.update({ where: { id }, data: { name, category, price } })

  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string } | undefined
  if (!session || !isAllowedRole(user?.role)) {
    return NextResponse.json({ error: 'Only admins and cashiers can delete misc items' }, { status: 403 })
  }

  const body = await req.json()
  const id = Number(body?.id)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const existing = await prisma.miscItem.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  const salesCount = await prisma.miscSale.count({ where: { miscItemId: id } })
  if (salesCount > 0) {
    return NextResponse.json(
      { error: 'Cannot delete an item that has existing sales records.' },
      { status: 409 }
    )
  }

  await prisma.miscItem.delete({ where: { id } })

  return NextResponse.json({ success: true })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string } | undefined
  if (!session || !isAllowedRole(user?.role)) {
    return NextResponse.json({ error: 'Only admins and cashiers can add misc items' }, { status: 403 })
  }

  const body = await req.json()

  const barcode = String(body?.barcode ?? '').trim()
  const name = String(body?.name ?? '').trim()
  const category = String(body?.category ?? '').trim()
  const price = Number(body?.price)

  if (!barcode || !name || !category || !Number.isFinite(price) || price <= 0) {
    return NextResponse.json({ error: 'barcode, name, category and price are required' }, { status: 400 })
  }

  if (!['CIGARETTES', 'SNACKS', 'CUPS'].includes(category)) {
    return NextResponse.json({ error: 'category must be one of CIGARETTES, SNACKS, CUPS' }, { status: 400 })
  }

  const existing = await prisma.miscItem.findUnique({ where: { barcode } })
  if (existing) {
    return NextResponse.json({ error: 'A misc item with this barcode already exists' }, { status: 409 })
  }

  const item = await prisma.miscItem.create({
    data: {
      barcode,
      name,
      category,
      price,
    },
  })

  return NextResponse.json(item)
}
