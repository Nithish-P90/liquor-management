import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { normalizeStockEntry } from '@/lib/stock-utils'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { entries } = body

  // Auto-create today's session if none exists
  let session = await prisma.inventorySession.findFirst({
    orderBy: { periodStart: 'desc' },
  })

  if (!session) {
    const today = new Date()
    const todayNoon = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12, 0, 0))
    // Find any staff member to assign as creator
    const staff = await prisma.staff.findFirst({ where: { active: true } })
    if (!staff) return NextResponse.json({ error: 'No staff found' }, { status: 400 })
    session = await prisma.inventorySession.create({
      data: { periodStart: todayNoon, periodEnd: todayNoon, staffId: staff.id }
    })
  }

  const sessionId = session.id

  // Fetch all referenced product sizes in one query instead of N queries
  const productSizeIds: number[] = entries.map((e: any) => e.productSizeId)
  const productSizes = await prisma.productSize.findMany({
    where: { id: { in: productSizeIds } },
    select: { id: true, bottlesPerCase: true },
  })
  const psMap = new Map(productSizes.map(ps => [ps.id, ps]))

  const created = await Promise.all(
    entries.map(async (e: any) => {
      const ps = psMap.get(e.productSizeId)
      const normalized = normalizeStockEntry(e.cases, e.bottles, ps?.bottlesPerCase ?? 12)
      return prisma.stockEntry.upsert({
        where: {
          sessionId_productSizeId_entryType: {
            sessionId,
            productSizeId: e.productSizeId,
            entryType: 'OPENING',
          },
        },
        update: {
          cases: normalized.cases,
          bottles: normalized.bottles,
          totalBottles: normalized.totalBottles,
        },
        create: {
          sessionId,
          productSizeId: e.productSizeId,
          entryType: 'OPENING',
          cases: normalized.cases,
          bottles: normalized.bottles,
          totalBottles: normalized.totalBottles,
        },
      })
    })
  )
  return NextResponse.json({ saved: created.length })
}

export async function GET() {
  // Run both queries in parallel — no dependency between them
  const [allProductSizes, latestSession] = await Promise.all([
    prisma.productSize.findMany({
      include: { product: true },
      orderBy: [
        { product: { category: 'asc' } },
        { product: { name: 'asc' } },
        { sizeMl: 'desc' },
      ],
    }),
    prisma.inventorySession.findFirst({
      orderBy: { periodStart: 'desc' },
      include: {
        stockEntries: {
          where: { entryType: 'OPENING' },
        },
      },
    }),
  ])

  // Build a lookup: productSizeId → entry
  const entryMap = new Map(
    (latestSession?.stockEntries ?? []).map(e => [e.productSizeId, e])
  )

  // Return ALL products; use 0 for those without an opening entry
  const formatted = allProductSizes.map(ps => {
    const entry = entryMap.get(ps.id)
    return {
      id:           ps.id,
      productName:  ps.product.name,
      category:     ps.product.category,
      sizeMl:       ps.sizeMl,
      bottlesPerCase: ps.bottlesPerCase,
      cases:        entry?.cases        ?? 0,
      bottles:      entry?.bottles      ?? 0,
      totalBottles: entry?.totalBottles ?? 0,
    }
  })

  return NextResponse.json(formatted)
}
