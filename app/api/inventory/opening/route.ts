import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { normalizeStockEntry } from '@/lib/stock-utils'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { sessionId, entries } = body
  // entries: [{ productSizeId, cases, bottles }]

  const created = await Promise.all(
    entries.map(async (e: any) => {
      const ps = await prisma.productSize.findUnique({ where: { id: e.productSizeId } })
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
