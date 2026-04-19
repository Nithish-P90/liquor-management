import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  createMiscSalesForDate,
  listMiscSalesForDate,
  resolveMiscSalesDay,
} from '@/lib/misc-sales'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
}

function isAllowedRole(role?: string) {
  return role === 'ADMIN' || role === 'CASHIER' || role === 'STAFF'
}

function toErrorStatus(message: string) {
  if (message.startsWith('Invalid date')) return 400
  if (message === 'At least one item is required') return 400
  if (message === 'Invalid item payload') return 400
  if (message.startsWith('Unknown misc item id')) return 404
  if (message === 'No active staff found for misc sale attribution') return 400
  return 500
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { id?: string; role?: string } | undefined
  if (!session || !isAllowedRole(user?.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dateParam = req.nextUrl.searchParams.get('date')
  const fromParam = req.nextUrl.searchParams.get('from')
  const toParam   = req.nextUrl.searchParams.get('to')
  const sessionStaffId = Number(user?.id ?? 0)
  const scopedStaffId = user?.role === 'STAFF' && Number.isInteger(sessionStaffId) && sessionStaffId > 0
    ? sessionStaffId
    : null

  // ── Date range summary (/api/misc-sales?from=YYYY-MM-DD&to=YYYY-MM-DD) ──
  if (fromParam && toParam) {
    try {
      const fromScope = resolveMiscSalesDay(fromParam)
      const toScope   = resolveMiscSalesDay(toParam)
      const where = {
        saleDate: { gte: fromScope.dayStart, lte: toScope.nextDayStart },
        ...(scopedStaffId ? { staffId: scopedStaffId } : {}),
      }
      const [agg, catAgg] = await Promise.all([
        prisma.miscSale.aggregate({
          where,
          _sum: { totalAmount: true, quantity: true },
          _count: { _all: true },
        }),
        prisma.miscSale.groupBy({
          by: ['paymentMode'],
          where,
          _sum: { totalAmount: true, quantity: true },
          _count: { _all: true },
        }),
      ])
      const [catCigAgg, catSnkAgg, catCupAgg] = await Promise.all([
        prisma.miscSale.aggregate({ where: { ...where, item: { category: 'CIGARETTES' } }, _sum: { totalAmount: true, quantity: true }, _count: { _all: true } }),
        prisma.miscSale.aggregate({ where: { ...where, item: { category: 'SNACKS' } },     _sum: { totalAmount: true, quantity: true }, _count: { _all: true } }),
        prisma.miscSale.aggregate({ where: { ...where, item: { category: 'CUPS' } },       _sum: { totalAmount: true, quantity: true }, _count: { _all: true } }),
      ])
      return NextResponse.json({
        from: fromScope.isoDate,
        to: toScope.isoDate,
        totalAmount: Number(agg._sum.totalAmount ?? 0),
        totalItems: Number(agg._sum.quantity ?? 0),
        totalEntries: agg._count._all,
        byMode: catAgg.map(g => ({ mode: g.paymentMode, amount: Number(g._sum.totalAmount ?? 0), qty: Number(g._sum.quantity ?? 0) })),
        categories: {
          CIGARETTES: { amount: Number(catCigAgg._sum.totalAmount ?? 0), items: Number(catCigAgg._sum.quantity ?? 0), entries: catCigAgg._count._all },
          SNACKS:     { amount: Number(catSnkAgg._sum.totalAmount ?? 0), items: Number(catSnkAgg._sum.quantity ?? 0), entries: catSnkAgg._count._all },
          CUPS:       { amount: Number(catCupAgg._sum.totalAmount ?? 0), items: Number(catCupAgg._sum.quantity ?? 0), entries: catCupAgg._count._all },
        },
      }, { headers: NO_STORE_HEADERS })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load range summary'
      return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE_HEADERS })
    }
  }

  try {
    const { scope, rows, summary } = await listMiscSalesForDate({
      dateInput: dateParam,
      staffId: scopedStaffId,
    })

    return NextResponse.json({
      date: scope.isoDate,
      summary,
      rows: rows.map(sale => ({
        id: sale.id,
        staffId: sale.staffId,
        staffName: sale.staff.name,
        quantity: sale.quantity,
        unitPrice: Number(sale.unitPrice),
        totalAmount: Number(sale.totalAmount),
        saleDate: scope.isoDate,
        saleTime: sale.saleTime,
        paymentMode: sale.paymentMode,
        item: {
          id: sale.item.id,
          barcode: sale.item.barcode,
          name: sale.item.name,
          category: sale.item.category,
          unit: sale.item.unit,
          price: Number(sale.item.price),
        },
      })),
    }, {
      headers: NO_STORE_HEADERS,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load misc sales'
    return NextResponse.json({ error: message }, { status: toErrorStatus(message), headers: NO_STORE_HEADERS })
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { id?: string; role?: string } | undefined
  if (!session || !isAllowedRole(user?.role)) {
    return NextResponse.json({ error: 'Only admins and cashiers can record misc sales' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const saleDateInput = typeof body?.saleDate === 'string' ? body.saleDate : null

  if (!saleDateInput) {
    return NextResponse.json({ error: 'saleDate is required' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  if (user?.role === 'STAFF') {
    const userStaffId = Number(user.id ?? 0)
    const requestedStaffId = Number(body?.staffId ?? userStaffId)
    if (!Number.isInteger(userStaffId) || userStaffId <= 0 || requestedStaffId !== userStaffId) {
      return NextResponse.json({ error: 'Staff can only record misc sales under their own staff id' }, { status: 403, headers: NO_STORE_HEADERS })
    }
  }

  try {
    const created = await createMiscSalesForDate({
      saleDateInput,
      requestedStaffId: body?.staffId,
      sessionStaffId: user?.id,
      itemsInput: body?.items,
      paymentMode: body?.paymentMode,
    })

    const scope = resolveMiscSalesDay(saleDateInput)
    const scopedStaffId = user?.role === 'STAFF' ? Number(user.id ?? 0) : null
    const { summary } = await listMiscSalesForDate({
      dateInput: scope.isoDate,
      staffId: Number.isInteger(scopedStaffId) && (scopedStaffId ?? 0) > 0 ? scopedStaffId : null,
    })

    return NextResponse.json({
      success: true,
      date: created.scope.isoDate,
      staffId: created.staffId,
      count: created.createdLines.length,
      created: created.createdLines,
      createdTotals: created.createdTotals,
      summary,
    }, {
      headers: NO_STORE_HEADERS,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to record misc sale'
    return NextResponse.json({ error: message }, { status: toErrorStatus(message), headers: NO_STORE_HEADERS })
  }
}
