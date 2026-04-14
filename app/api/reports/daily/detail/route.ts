/**
 * GET /api/reports/daily/detail?sessionId=X
 *
 * Returns a comprehensive breakdown of one day's ledger:
 *   - Full sales transaction list (time, product, staff, qty, amount, mode)
 *   - Indent receipts received that day (product, cases, bottles)
 *   - Expenses (particulars, category, amount)
 *   - Staff attendance (check-in/out, hours worked)
 *   - Stock adjustments / breakages
 *   - Opening stock snapshot — ALL products with their opening qty
 *   - Closing stock snapshot — ALL products with computed closing qty
 */

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'
import { splitStock } from '@/lib/stock-utils'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const url       = new URL(req.url)
    const sessionId = parseInt(url.searchParams.get('sessionId') ?? '')
    if (!sessionId || isNaN(sessionId)) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    }

    const session = await prisma.inventorySession.findUnique({
      where: { id: sessionId },
    })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const dateOnly = toUtcNoonDate(session.periodStart)
    const isToday  = dateOnly.getTime() === toUtcNoonDate(new Date()).getTime()

    // Upper time boundary — today's sessions are live (use now), past sessions use EOD
    const now      = new Date()
    const boundary = isToday ? now : session.periodEnd

    // ── 1. All product sizes (needed for stock snapshots) ──────────────────────
    const productSizes = await prisma.productSize.findMany({
      include: { product: true },
      orderBy: [
        { product: { category: 'asc' } },
        { product: { name: 'asc'     } },
        { sizeMl: 'desc'              },
      ],
    })

    // ── 2. Sales list ──────────────────────────────────────────────────────────
    const salesRows = await prisma.sale.findMany({
      where:   { saleDate: dateOnly },
      include: {
        productSize: { include: { product: true } },
        staff:       { select: { name: true } },
      },
      orderBy: { saleTime: 'asc' },
    })

    const sales = salesRows.map(s => ({
      id:          s.id,
      time:        s.saleTime,
      productName: s.productSize.product.name,
      category:    s.productSize.product.category,
      sizeMl:      s.productSize.sizeMl,
      qty:         s.quantityBottles,
      price:       Number(s.sellingPrice),
      total:       Number(s.totalAmount),
      paymentMode: s.paymentMode,
      staffName:   s.staff.name,
      scanMethod:  s.scanMethod,
    }))

    // ── 3. Indent receipts ─────────────────────────────────────────────────────
    const receiptsRows = await prisma.receiptItem.findMany({
      where: { receipt: { receivedDate: dateOnly } },
      include: {
        productSize: { include: { product: true } },
        receipt:     { include: { indent: true } },
      },
    })

    const receipts = receiptsRows.map(r => ({
      id:            r.id,
      indentNumber:  r.receipt.indent.indentNumber,
      invoiceNumber: r.receipt.indent.invoiceNumber,
      productName:   r.productSize.product.name,
      category:      r.productSize.product.category,
      sizeMl:        r.productSize.sizeMl,
      cases:         r.casesReceived,
      bottles:       r.bottlesReceived,
      totalBottles:  r.totalBottles,
    }))

    // ── 4. Expenses ────────────────────────────────────────────────────────────
    const expRows = await prisma.expenditure.findMany({
      where:   { expDate: dateOnly },
      orderBy: { createdAt: 'asc' },
    })

    const expenses = expRows.map(e => ({
      id:          e.id,
      particulars: e.particulars,
      category:    e.category,
      amount:      Number(e.amount),
    }))

    // ── 5. Staff attendance ────────────────────────────────────────────────────
    const allStaff = await prisma.staff.findMany({
      where:   { active: true },
      orderBy: { name: 'asc' },
      select:  { id: true, name: true, role: true },
    })

    const attLogs = await prisma.attendanceLog.findMany({
      where: { date: dateOnly },
    })
    const logMap = new Map(attLogs.map(l => [l.staffId, l]))

    const attendance = allStaff.map(s => {
      const log = logMap.get(s.id)
      let hoursWorked: number | null = null
      if (log?.checkIn && log?.checkOut) {
        hoursWorked = (new Date(log.checkOut).getTime() - new Date(log.checkIn).getTime()) / 3_600_000
      } else if (log?.checkIn && isToday) {
        hoursWorked = (now.getTime() - new Date(log.checkIn).getTime()) / 3_600_000
      }
      return {
        staffId:     s.id,
        staffName:   s.name,
        role:        s.role,
        checkIn:     log?.checkIn  ?? null,
        checkOut:    log?.checkOut ?? null,
        hoursWorked: hoursWorked !== null ? Math.round(hoursWorked * 10) / 10 : null,
        status:      !log ? 'ABSENT' : !log.checkOut ? 'IN' : 'OUT',
      }
    })

    // ── 6. Stock adjustments ───────────────────────────────────────────────────
    const adjRows = await prisma.stockAdjustment.findMany({
      where:   { adjustmentDate: dateOnly },
      include: {
        productSize: { include: { product: true } },
        createdBy:   { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    const adjustments = adjRows.map(a => ({
      id:             a.id,
      productName:    a.productSize.product.name,
      category:       a.productSize.product.category,
      sizeMl:         a.productSize.sizeMl,
      type:           a.adjustmentType,
      qty:            a.quantityBottles,
      reason:         a.reason,
      approved:       a.approved,
      createdBy:      a.createdBy.name,
    }))

    // ── 7. Opening stock snapshot (ALL products) ───────────────────────────────
    const openingEntries = await prisma.stockEntry.findMany({
      where: { sessionId, entryType: 'OPENING' },
    })
    const openingMap = new Map(openingEntries.map(e => [e.productSizeId, e]))

    const openingStock = productSizes
      .map(ps => {
        const entry = openingMap.get(ps.id)
        const total = entry?.totalBottles ?? 0
        const { cases, bottles } = splitStock(total, ps.bottlesPerCase)
        return {
          productSizeId: ps.id,
          productName:   ps.product.name,
          category:      ps.product.category,
          sizeMl:        ps.sizeMl,
          cases,
          bottles,
          totalBottles:  total,
          value:         total * Number(ps.sellingPrice),
        }
      })
      .filter(r => r.totalBottles > 0)  // only non-zero opening

    // ── 8. Closing stock snapshot (ALL products, computed) ─────────────────────
    //   closing = opening + receipts_in_session + adjustments - sales
    const psIds = productSizes.map(ps => ps.id)

    const [allReceiptItems, allSalesAgg, allAdjAgg] = await Promise.all([
      prisma.receiptItem.findMany({
        where: {
          productSizeId: { in: psIds },
          receipt: { receivedDate: { gte: session.periodStart, lte: boundary } },
        },
        select: { productSizeId: true, totalBottles: true },
      }),
      prisma.sale.groupBy({
        by:    ['productSizeId'],
        where: {
          productSizeId: { in: psIds },
          saleDate: { gte: session.periodStart, lte: boundary },
        },
        _sum: { quantityBottles: true },
      }),
      prisma.stockAdjustment.groupBy({
        by:    ['productSizeId'],
        where: {
          productSizeId: { in: psIds },
          approved:      true,
          adjustmentDate: { gte: session.periodStart, lte: boundary },
        },
        _sum: { quantityBottles: true },
      }),
    ])

    const rcptMap = new Map<number, number>()
    for (const r of allReceiptItems) {
      rcptMap.set(r.productSizeId, (rcptMap.get(r.productSizeId) ?? 0) + r.totalBottles)
    }
    const saleMap = new Map(allSalesAgg.map(s => [s.productSizeId, s._sum.quantityBottles ?? 0]))
    const adjMap  = new Map(allAdjAgg.map(a => [a.productSizeId, a._sum.quantityBottles ?? 0]))

    type ClosingRow = {
      productSizeId:   number
      productName:     string
      category:        string
      sizeMl:          number
      cases:           number
      bottles:         number
      totalBottles:    number
      value:           number
      openingBottles:  number
      receiptsBottles: number
      salesBottles:    number
      adjBottles:      number
    }

    const closingStock: ClosingRow[] = productSizes
      .map(ps => {
        const op       = openingMap.get(ps.id)?.totalBottles ?? 0
        const rcpt     = rcptMap.get(ps.id) ?? 0
        const sold     = saleMap.get(ps.id) ?? 0
        const adj      = adjMap.get(ps.id)  ?? 0
        const closing  = Math.max(0, op + rcpt + adj - sold)

        if (closing === 0 && op === 0 && rcpt === 0 && sold === 0) return null

        const { cases, bottles } = splitStock(closing, ps.bottlesPerCase)
        return {
          productSizeId:   ps.id,
          productName:     ps.product.name,
          category:        String(ps.product.category),
          sizeMl:          ps.sizeMl,
          cases,
          bottles,
          totalBottles:    closing,
          value:           closing * Number(ps.sellingPrice),
          openingBottles:  op,
          receiptsBottles: rcpt,
          salesBottles:    sold,
          adjBottles:      adj,
        } satisfies ClosingRow
      })
      .filter((r): r is ClosingRow => r !== null)

    // ── 9. Financial summary ───────────────────────────────────────────────────
    const salesByMode: Record<string, number> = { CASH: 0, UPI: 0, CARD: 0, CREDIT: 0, SPLIT: 0 }
    let totalSales = 0, totalBottlesSold = 0, totalBills = 0

    for (const s of salesRows) {
      const amount = Number(s.totalAmount)
      if (s.paymentMode === 'SPLIT') {
        salesByMode.CASH += Number(s.cashAmount ?? 0)
        salesByMode.CARD += Number(s.cardAmount ?? 0)
        salesByMode.UPI += Number(s.upiAmount ?? 0)
        salesByMode.SPLIT += 0
      } else {
        salesByMode[s.paymentMode] = (salesByMode[s.paymentMode] ?? 0) + amount
      }
      totalSales       += amount
      totalBottlesSold += s.quantityBottles
      totalBills++
    }
    const totalExpenses = expenses.reduce((s: number, e) => s + e.amount, 0)
    const closingTotal  = closingStock.reduce((s: number, r) => s + r.totalBottles, 0)

    // ── 10. Cash register record for this day ─────────────────────────────────
    const cashRecord = await prisma.cashRecord.findUnique({
      where: { recordDate: dateOnly }
    })

    // ── 11. Bank deposits on this day ─────────────────────────────────────────
    const bankDeposits = await prisma.bankTransaction.findMany({
      where: { txDate: dateOnly, txType: 'DEPOSIT' },
      orderBy: { createdAt: 'asc' }
    })

    const cashFlow = {
      openingRegister:  cashRecord ? Number(cashRecord.openingRegister) : null,
      cashSales:        cashRecord ? Number(cashRecord.cashSales) : null,
      expenses:         cashRecord ? Number(cashRecord.expenses) : null,
      cashToLocker:     cashRecord ? Number(cashRecord.cashToLocker) : null,
      closingRegister:  cashRecord ? Number(cashRecord.closingRegister) : null,
      bankDeposits:     bankDeposits.map(b => ({ id: b.id, amount: Number(b.amount), notes: b.notes })),
      totalBankDeposited: bankDeposits.reduce((s, b) => s + Number(b.amount), 0),
    }

    return NextResponse.json({
      sessionId,
      date:    session.periodStart,
      isToday,
      financials: {
        totalSales,
        totalExpenses,
        netCash:         salesByMode.CASH - totalExpenses,
        salesByMode,
        totalBottlesSold,
        totalBills,
      },
      cashFlow,
      sales,
      receipts,
      expenses,
      attendance,
      adjustments,
      openingStock,
      closingStock,
      closingTotal,
      openingTotal: openingStock.reduce((s, r) => s + r.totalBottles, 0),
    })
  } catch (error: any) {
    console.error('[daily-detail]', error)
    return NextResponse.json({ error: 'Failed to load daily detail' }, { status: 500 })
  }
}
