import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { normalizeStockEntry } from '@/lib/stock-utils'
import { requireAdmin } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const [, authErr] = await requireAdmin()
  if (authErr) return authErr

  const body = await req.json()
  const { sessionId, entries } = body

  // Batch-fetch all referenced product sizes in one query
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
            entryType: 'CLOSING',
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
          entryType: 'CLOSING',
          cases: normalized.cases,
          bottles: normalized.bottles,
          totalBottles: normalized.totalBottles,
        },
      })
    })
  )
  return NextResponse.json({ saved: created.length })
}
