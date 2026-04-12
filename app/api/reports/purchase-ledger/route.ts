import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/reports/purchase-ledger
 *
 * Returns all stock received from KSBCL indents for audit purposes.
 * Can filter by date range with ?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const where: any = {}
  if (from) where.receivedDate = { ...where.receivedDate, gte: new Date(from) }
  if (to) where.receivedDate = { ...where.receivedDate, lte: new Date(to) }

  const receipts = await prisma.receipt.findMany({
    where,
    include: {
      indent: {
        select: { indentNumber: true, invoiceNumber: true, indentDate: true },
      },
      items: {
        include: {
          productSize: { include: { product: true } },
        },
      },
    },
    orderBy: { receivedDate: 'desc' },
  })

  const entries = receipts.flatMap(r =>
    r.items.map(item => ({
      receivedDate: r.receivedDate,
      indentNumber: r.indent?.indentNumber ?? 'Direct',
      invoiceNumber: r.indent?.invoiceNumber ?? '',
      productName: item.productSize.product.name,
      itemCode: item.productSize.product.itemCode,
      sizeMl: item.productSize.sizeMl,
      casesReceived: item.casesReceived,
      bottlesReceived: item.bottlesReceived,
      totalBottles: item.totalBottles,
      bottlesPerCase: item.productSize.bottlesPerCase,
    }))
  )

  const summary = {
    totalReceipts: receipts.length,
    totalItems: entries.length,
    totalBottles: entries.reduce((s, e) => s + e.totalBottles, 0),
  }

  return NextResponse.json({ entries, summary })
}
