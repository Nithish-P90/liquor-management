/**
 * GET /api/reports/daily/detail?date=YYYY-MM-DD
 *
 * Returns a comprehensive breakdown of one day:
 *   - Total sales + per-mode breakdown
 *   - Clerk/staff sales breakup
 *   - Sales transaction list
 *   - Expenses
 *   - Staff attendance
 *   - Opening stock (from session if available, else prior closing)
 *   - Closing stock (computed: opening + receipts + adj - sales)
 *   - Cash register / galla tally
 */

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { splitStock } from '@/lib/stock-utils'
import { resolveMiscSalesDay } from '@/lib/misc-sales'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const url     = new URL(req.url)
    const dateStr = url.searchParams.get('date')
    if (!dateStr) return NextResponse.json({ error: 'date required (YYYY-MM-DD)' }, { status: 400 })

    let scope: ReturnType<typeof resolveMiscSalesDay>
    try {
      scope = resolveMiscSalesDay(dateStr)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid date'
      return NextResponse.json({ error: message }, { status: 400 })
    }
    const dateOnly = scope.day
    const isToday = dateOnly.getTime() === resolveMiscSalesDay().day.getTime()
    const now     = new Date()

    // ── Fire all independent top-level queries in parallel ────────────────────
    const [
      salesRows,
      miscRows,
      expRows,
      allStaff,
      attLogs,
      adjRows,
      receiptsRows,
      session,
      productSizes,
      cashRecord,
      bankDeposits,
      pendingUnpaid,
      pendingTotalAgg,
      voidAgg,
    ] = await Promise.all([
      prisma.sale.findMany({
        where:   { saleDate: dateOnly, quantityBottles: { gt: 0 }, productSize: { product: { category: { not: 'MISCELLANEOUS' } } } },
        include: {
          productSize: { include: { product: true } },
          staff:       { select: { id: true, name: true, role: true } },
        },
        orderBy: { saleTime: 'asc' },
      }),
      prisma.miscSale.findMany({
        where: { saleDate: { gte: scope.dayStart, lt: scope.nextDayStart } },
        include: { item: true, staff: { select: { id: true, name: true, role: true } } },
        orderBy: { saleTime: 'asc' },
      }),
      prisma.expenditure.findMany({ where: { expDate: dateOnly }, orderBy: { createdAt: 'asc' } }),
      prisma.staff.findMany({
        where:   { active: true },
        orderBy: { name: 'asc' },
        select:  { id: true, name: true, role: true, expectedCheckIn: true, expectedCheckOut: true, lateGraceMinutes: true },
      }),
      prisma.attendanceLog.findMany({ where: { date: dateOnly } }),
      prisma.stockAdjustment.findMany({
        where:   { adjustmentDate: dateOnly },
        include: { productSize: { include: { product: true } }, createdBy: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.receiptItem.findMany({
        where:   { receipt: { receivedDate: dateOnly } },
        include: { productSize: { include: { product: true } }, receipt: { include: { indent: true } } },
      }),
      prisma.inventorySession.findFirst({
        where: { periodStart: { lte: dateOnly }, periodEnd: { gte: dateOnly } },
        orderBy: { periodStart: 'desc' },
      }),
      prisma.productSize.findMany({
        include: { product: true },
        orderBy: [{ product: { category: 'asc' } }, { product: { name: 'asc' } }, { sizeMl: 'desc' }],
      }),
      prisma.cashRecord.findUnique({ where: { recordDate: dateOnly } }),
      prisma.bankTransaction.findMany({ where: { txDate: dateOnly, txType: 'DEPOSIT' }, orderBy: { createdAt: 'asc' } }),
      prisma.pendingBill.count({ where: { saleDate: dateOnly, settled: false } }),
      prisma.pendingBill.aggregate({ where: { saleDate: dateOnly, settled: false }, _sum: { totalAmount: true } }),
      prisma.sale.aggregate({
        where: { saleDate: dateOnly, paymentMode: 'VOID', productSize: { product: { category: { not: 'MISCELLANEOUS' } } } },
        _sum: { totalAmount: true },
      }),
    ])

    const pendingUnpaidAmount = Number(pendingTotalAgg._sum.totalAmount ?? 0)
    const psIds = productSizes.map(ps => ps.id)

    // ── 1. Sales list ──────────────────────────────────────────────────────────
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
      staffId:     s.staffId,
      staffName:   s.staff.name,
    }))

    const miscSales = miscRows.map(s => ({
      id: s.id,
      time: s.saleTime,
      itemName: s.item.name,
      category: s.item.category,
      unit: s.item.unit,
      qty: s.quantity,
      unitPrice: Number(s.unitPrice),
      total: Number(s.totalAmount),
    }))

    // ── 2. Clerk breakup ───────────────────────────────────────────────────────
    const CLERK_POOL_ID = -1
    const clerkMap = new Map<number, { name: string; role: string; bottles: number; total: number; bills: Set<string> }>()
    for (const s of salesRows) {
      const isCashier = s.staff.role === 'CASHIER'
      const key = isCashier ? CLERK_POOL_ID : s.staffId
      const existing = clerkMap.get(key)
      if (existing) {
        existing.bottles += s.quantityBottles
        existing.total   += Number(s.totalAmount)
        existing.bills.add(String(s.id))
      } else {
        clerkMap.set(key, {
          name:    isCashier ? 'Clerk' : s.staff.name,
          role:    isCashier ? 'CASHIER' : s.staff.role,
          bottles: s.quantityBottles,
          total:   Number(s.totalAmount),
          bills:   new Set([String(s.id)]),
        })
      }
    }
    const clerkBreakup = Array.from(clerkMap.entries())
      .map(([staffId, d]) => ({ staffId, staffName: d.name, role: d.role, bottles: d.bottles, total: d.total, bills: d.bills.size }))
      .sort((a, b) => b.total - a.total)

    // ── 3. Expenses ────────────────────────────────────────────────────────────
    const expenses = expRows.map(e => ({ id: e.id, particulars: e.particulars, category: e.category, amount: Number(e.amount) }))

    // ── 4. Attendance ──────────────────────────────────────────────────────────
    const logMap = new Map(attLogs.map(l => [l.staffId, l]))

    function isLate(actualIso: Date | string | null | undefined, scheduledHHMM: string | null | undefined, graceMinutes: number): boolean {
      if (!actualIso || !scheduledHHMM) return false
      const actual = new Date(actualIso)
      const [sh, sm] = scheduledHHMM.split(':').map(Number)
      const scheduled = new Date(actual)
      scheduled.setHours(sh, sm + graceMinutes, 0, 0)
      return actual > scheduled
    }

    const attendance = allStaff.map(s => {
      const log = logMap.get(s.id)
      let hoursWorked: number | null = null
      if (log?.checkIn && log?.checkOut) {
        hoursWorked = (new Date(log.checkOut).getTime() - new Date(log.checkIn).getTime()) / 3_600_000
      } else if (log?.checkIn && isToday) {
        hoursWorked = (now.getTime() - new Date(log.checkIn).getTime()) / 3_600_000
      }
      const grace = s.lateGraceMinutes ?? 15
      return {
        staffId: s.id, staffName: s.name, role: s.role,
        checkIn: log?.checkIn ?? null, checkOut: log?.checkOut ?? null,
        hoursWorked: hoursWorked !== null ? Math.round(hoursWorked * 10) / 10 : null,
        status: !log ? 'ABSENT' : !log.checkOut ? 'IN' : 'OUT',
        lateCheckIn:  isLate(log?.checkIn,  s.expectedCheckIn,  grace),
        lateCheckOut: isLate(log?.checkOut, s.expectedCheckOut, grace),
        expectedCheckIn:  s.expectedCheckIn  ?? null,
        expectedCheckOut: s.expectedCheckOut ?? null,
      }
    })

    // ── 5. Stock adjustments ───────────────────────────────────────────────────
    const adjustments = adjRows.map(a => ({
      id: a.id, productName: a.productSize.product.name, category: a.productSize.product.category,
      sizeMl: a.productSize.sizeMl, type: a.adjustmentType, qty: a.quantityBottles,
      reason: a.reason, approved: a.approved, createdBy: a.createdBy.name,
    }))

    // ── 6. Receipts ────────────────────────────────────────────────────────────
    const receipts = receiptsRows.map(r => ({
      id: r.id, indentNumber: r.receipt.indent.indentNumber, invoiceNumber: r.receipt.indent.invoiceNumber,
      productName: r.productSize.product.name, category: r.productSize.product.category,
      sizeMl: r.productSize.sizeMl, cases: r.casesReceived, bottles: r.bottlesReceived, totalBottles: r.totalBottles,
    }))

    // ── 7. Opening & Closing stock ─────────────────────────────────────────────
    const periodStart = session?.periodStart ?? dateOnly
    const boundary    = isToday ? now : new Date(dateOnly.getTime() + 86400000 - 1)

    // Fire opening entries + stock movement queries in parallel
    const [openingEntries, allReceiptItems, allSalesAgg, allAdjAgg] = await Promise.all([
      session
        ? prisma.stockEntry.findMany({ where: { sessionId: session.id, entryType: 'OPENING' } })
        : Promise.resolve([]),
      prisma.receiptItem.findMany({
        where: { productSizeId: { in: psIds }, receipt: { receivedDate: { gte: periodStart, lte: boundary } } },
        select: { productSizeId: true, totalBottles: true },
      }),
      prisma.sale.groupBy({
        by: ['productSizeId'],
        where: { productSizeId: { in: psIds }, saleDate: { gte: periodStart, lte: boundary }, quantityBottles: { gt: 0 } },
        _sum: { quantityBottles: true },
      }),
      prisma.stockAdjustment.groupBy({
        by: ['productSizeId'],
        where: { productSizeId: { in: psIds }, approved: true, adjustmentDate: { gte: periodStart, lte: boundary } },
        _sum: { quantityBottles: true },
      }),
    ])

    const openingMap = new Map(openingEntries.map(e => [e.productSizeId, e.totalBottles]))
    const rcptMap = new Map<number, number>()
    for (const r of allReceiptItems) rcptMap.set(r.productSizeId, (rcptMap.get(r.productSizeId) ?? 0) + r.totalBottles)
    const saleMap = new Map(allSalesAgg.map(s => [s.productSizeId, s._sum.quantityBottles ?? 0]))
    const adjMap  = new Map(allAdjAgg.map(a => [a.productSizeId, a._sum.quantityBottles ?? 0]))

    // No-session: also query just this date's movements (same queries already scoped to dateOnly above when periodStart=dateOnly)
    const todaySaleMap = session ? saleMap : new Map(allSalesAgg.map(s => [s.productSizeId, s._sum.quantityBottles ?? 0]))
    const todayRcptMap = new Map<number, number>()
    if (!session) {
      for (const r of allReceiptItems) todayRcptMap.set(r.productSizeId, (todayRcptMap.get(r.productSizeId) ?? 0) + r.totalBottles)
    }

    const openingStock = productSizes
      .map(ps => {
        const total = openingMap.get(ps.id) ?? 0
        const { cases, bottles } = splitStock(total, ps.bottlesPerCase)
        return { productSizeId: ps.id, productName: ps.product.name, category: ps.product.category, sizeMl: ps.sizeMl, cases, bottles, totalBottles: total, value: total * Number(ps.sellingPrice) }
      })
      .filter(r => r.totalBottles > 0)

    type ClosingRow = {
      productSizeId: number; productName: string; category: string; sizeMl: number
      cases: number; bottles: number; totalBottles: number; value: number
      openingBottles: number; receiptsBottles: number; salesBottles: number; adjBottles: number
    }

    const closingStock: ClosingRow[] = productSizes
      .map(ps => {
        const op   = openingMap.get(ps.id) ?? 0
        const rcpt = session ? (rcptMap.get(ps.id) ?? 0) : (todayRcptMap.get(ps.id) ?? 0)
        const sold = session ? (saleMap.get(ps.id) ?? 0) : (todaySaleMap.get(ps.id) ?? 0)
        const adj  = adjMap.get(ps.id) ?? 0
        const closing = Math.max(0, op + rcpt + adj - sold)
        if (closing === 0 && op === 0 && rcpt === 0 && sold === 0) return null
        const { cases, bottles } = splitStock(closing, ps.bottlesPerCase)
        return {
          productSizeId: ps.id, productName: ps.product.name, category: String(ps.product.category), sizeMl: ps.sizeMl,
          cases, bottles, totalBottles: closing, value: closing * Number(ps.sellingPrice),
          openingBottles: op, receiptsBottles: rcpt, salesBottles: sold, adjBottles: adj,
        } satisfies ClosingRow
      })
      .filter((r): r is ClosingRow => r !== null)

    // ── 8. Financial summary ───────────────────────────────────────────────────
    const salesByMode: Record<string, number> = { CASH: 0, UPI: 0, CARD: 0, CREDIT: 0, SPLIT: 0 }
    let totalSales = 0, totalBottlesSold = 0, totalBills = 0

    for (const s of salesRows) {
      const amount = Number(s.totalAmount)
      if (s.paymentMode === 'SPLIT') {
        salesByMode.CASH += Number(s.cashAmount ?? 0)
        salesByMode.CARD += Number(s.cardAmount ?? 0)
        salesByMode.UPI  += Number(s.upiAmount  ?? 0)
      } else {
        salesByMode[s.paymentMode] = (salesByMode[s.paymentMode] ?? 0) + amount
      }
      totalSales += amount; totalBottlesSold += s.quantityBottles; totalBills++
    }

    const miscSalesTotal = miscSales.reduce((sum, row) => sum + row.total, 0)
    const miscItemsSold = miscSales.reduce((sum, row) => sum + row.qty, 0)
    const miscEntries = miscSales.length
    const voidAmount = Number(voidAgg._sum.totalAmount ?? 0)

    // Add misc amounts into the same payment-mode buckets
    for (const ms of miscRows) {
      const amount = Number(ms.totalAmount)
      const mode = ms.paymentMode as string
      salesByMode[mode] = (salesByMode[mode] ?? 0) + amount
    }

    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)
    const closingTotal  = closingStock.reduce((s, r) => s + r.totalBottles, 0)
    const openingTotal  = openingStock.reduce((s, r) => s + r.totalBottles, 0)

    // ── 9. Cash flow ───────────────────────────────────────────────────────────
    const cashFlow = {
      openingRegister:    cashRecord ? Number(cashRecord.openingRegister)  : null,
      cashSales:          cashRecord ? Number(cashRecord.cashSales)         : null,
      expenses:           cashRecord ? Number(cashRecord.expenses)          : null,
      cashToLocker:       cashRecord ? Number(cashRecord.cashToLocker)      : null,
      closingRegister:    cashRecord ? Number(cashRecord.closingRegister)   : null,
      bankDeposits:       bankDeposits.map(b => ({ id: b.id, amount: Number(b.amount), notes: b.notes })),
      totalBankDeposited: bankDeposits.reduce((s, b) => s + Number(b.amount), 0),
    }

    return NextResponse.json({
      date: dateOnly,
      isToday,
      hasSession: !!session,
      financials: {
        totalSales: totalSales + voidAmount,
        totalExpenses,
        netCash: salesByMode.CASH + voidAmount - totalExpenses,
        salesByMode, totalBottlesSold, totalBills,
        miscSalesTotal,
        miscItemsSold,
        miscEntries,
        pendingUnpaid, pendingUnpaidAmount,
      },
      clerkBreakup,
      cashFlow,
      sales,
      miscSales,
      receipts,
      expenses,
      attendance,
      adjustments,
      openingStock, closingStock, closingTotal, openingTotal,
    })
  } catch (error: unknown) {
    console.error('[daily-detail]', error)
    return NextResponse.json({ error: 'Failed to load daily detail' }, { status: 500 })
  }
}
