/**
 * /api/misc-items
 * Standalone misc item catalogue — completely separate from the liquor Sale/Product tables.
 * Items here are sold via MiscSale, never via the liquor Sale table.
 *
 * GET    ?barcode=XXX  → single item (for barcode scanner lookup)
 * GET                  → all items, ordered by category then name
 * POST                 → create item (barcode optional)
 * PATCH                → edit name / category / unit / price
 * DELETE               → delete item (blocked if sales exist)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const VALID_CATEGORIES = ['CIGARETTES', 'SNACKS', 'CUPS'] as const
type MiscCategory = typeof VALID_CATEGORIES[number]

const VALID_UNITS = ['pcs', 'pack', 'box', 'strip'] as const
type MiscUnit = typeof VALID_UNITS[number]

function isAllowedRole(role?: string) {
  return role === 'ADMIN' || role === 'CASHIER'
}

function validCategory(v: unknown): v is MiscCategory {
  return VALID_CATEGORIES.includes(v as MiscCategory)
}

function validUnit(v: unknown): v is MiscUnit {
  return VALID_UNITS.includes(v as MiscUnit)
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string } | undefined
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // All roles can read items (STAFF need to see items in POS misc view)
  void user

  const barcode = req.nextUrl.searchParams.get('barcode')
  if (barcode) {
    const item = await prisma.miscItem.findUnique({
      where: { barcode: barcode.trim() },
    })
    if (!item) return NextResponse.json(null)
    return NextResponse.json({ ...item, price: Number(item.price) })
  }

  const items = await prisma.miscItem.findMany({
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })
  return NextResponse.json(items.map(i => ({ ...i, price: Number(i.price) })))
}

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string } | undefined
  if (!session || !isAllowedRole(user?.role)) {
    return NextResponse.json({ error: 'Only admins and cashiers can add misc items' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const name     = String(body.name     ?? '').trim()
  const category = String(body.category ?? '').trim()
  const unit     = String(body.unit     ?? 'pcs').trim()
  const price    = Number(body.price)
  const barcode  = body.barcode ? String(body.barcode).trim() : null

  if (!name)              return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!validCategory(category)) {
    return NextResponse.json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` }, { status: 400 })
  }
  if (!validUnit(unit)) {
    return NextResponse.json({ error: `unit must be one of: ${VALID_UNITS.join(', ')}` }, { status: 400 })
  }
  if (!Number.isFinite(price) || price <= 0) {
    return NextResponse.json({ error: 'price must be a positive number' }, { status: 400 })
  }

  // Barcode uniqueness check (only if provided)
  if (barcode) {
    const conflict = await prisma.miscItem.findUnique({ where: { barcode } })
    if (conflict) {
      return NextResponse.json({ error: 'A misc item with this barcode already exists' }, { status: 409 })
    }
  }

  const item = await prisma.miscItem.create({
    data: { name, category, unit, price, barcode },
  })

  return NextResponse.json({ ...item, price: Number(item.price) }, { status: 201 })
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string } | undefined
  if (!session || !isAllowedRole(user?.role)) {
    return NextResponse.json({ error: 'Only admins and cashiers can edit misc items' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const id = Number(body?.id)
  if (!id || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Valid id required' }, { status: 400 })
  }

  const existing = await prisma.miscItem.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  const name     = body.name     !== undefined ? String(body.name).trim()     : existing.name
  const category = body.category !== undefined ? String(body.category).trim() : existing.category
  const unit     = body.unit     !== undefined ? String(body.unit).trim()     : existing.unit
  const price    = body.price    !== undefined ? Number(body.price)           : Number(existing.price)

  if (!name)              return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!validCategory(category)) {
    return NextResponse.json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` }, { status: 400 })
  }
  if (!validUnit(unit)) {
    return NextResponse.json({ error: `unit must be one of: ${VALID_UNITS.join(', ')}` }, { status: 400 })
  }
  if (!Number.isFinite(price) || price <= 0) {
    return NextResponse.json({ error: 'price must be a positive number' }, { status: 400 })
  }

  const updated = await prisma.miscItem.update({
    where: { id },
    data: { name, category, unit, price },
  })

  return NextResponse.json({ ...updated, price: Number(updated.price) })
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string } | undefined
  if (!session || !isAllowedRole(user?.role)) {
    return NextResponse.json({ error: 'Only admins and cashiers can delete misc items' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const id = Number(body?.id)
  if (!id || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Valid id required' }, { status: 400 })
  }

  const existing = await prisma.miscItem.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  // itemId is the FK in MiscSale — not miscItemId
  const salesCount = await prisma.miscSale.count({ where: { itemId: id } })
  if (salesCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete — this item has ${salesCount} sale record(s). Edit it instead.` },
      { status: 409 }
    )
  }

  await prisma.miscItem.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
