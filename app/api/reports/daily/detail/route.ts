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
import { toUtcNoonDate } from '@/lib/date-utils'
import { splitStock } from '@/lib/stock-utils'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const url     = new URL(req.url)
    const dateStr = url.searchParams.get('date')
    if (!dateStr) return NextResponse.json({ error: 'date required (YYYY-MM-DD)' }, { status: 400 })

    const dateOnly = toUtcNoonDate(new Date(dateStr + 'T12:00:00Z'))
    if (isNaN(dateOnly.getTime())) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

    const isToday = dateOnly.getTime() === toUtcNoonDate(new Date()).getTime()
    const now     = new Date()

    // ── 1. Sales list ──────────────────────────────────────────────────────────
    const salesRows = await prisma.sale.findMany({
      where:   { saleDate: dateOnly, quantityBottles: { gt: 0 } },
      include: {
        productSize: { include: { product: true } },
        staff:       { select: { id: true, name: true, role: true } },
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
      staffId:     s.staffId,
      staffName:   s.staff.name,
    }))

    // ── 2. Clerk breakup ───────────────────────────────────────────────────────
    // All CASHIER-role sales are pooled under a single "Clerk" row (staffId = -1)
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
      .map(([staffId, d]) => ({
        staffId,
        staffName: d.name,
        role:      d.role,
        bottles:   d.bottles,
        total:     d.total,
        bills:     d.bills.size,
      }))
      .sort((a, b) => b.total - a.total)

    // ── 3. Expenses ────────────────────────────────────────────────────────────
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

    // ── 4. Staff attendance ────────────────────────────────────────────────────
    const allStaff = await prisma.staff.findMany({
      where:   { active: true },
      orderBy: { name: 'asc' },
      select:  { id: true, name: true, role: true, expectedCheckIn: true, expectedCheckOut: true, lateGraceMinutes: true },
    })
    const attLogs = await prisma.attendanceLog.findMany({ where: { date: dateOnly } })
    const logMap  = new Map(attLogs.map(l => [l.staffId, l]))

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
        staffId:          s.id,
        staffName:        s.name,
        role:             s.role,
        checkIn:          log?.checkIn  ?? null,
        checkOut:         log?.checkOut ?? null,
        hoursWorked:      hoursWorked !== null ? Math.round(hoursWorked * 10) / 10 : null,
        status:           !log ? 'ABSENT' : !log.checkOut ? 'IN' : 'OUT',
        lateCheckIn:      isLate(log?.checkIn,  s.expectedCheckIn,  grace),
        lateCheckOut:     isLate(log?.checkOut, s.expectedCheckOut, grace),
        expectedCheckIn:  s.expectedCheckIn  ?? null,
        expectedCheckOut: s.expectedCheckOut ?? null,
      }
    })

    // ── 5. Stock adjustments ───────────────────────────────────────────────────
    const adjRows = await prisma.stockAdjustment.findMany({
      where:   { adjustmentDate: dateOnly },
      include: {
        productSize: { include: { product: true } },
        createdBy:   { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    const adjustments = adjRows.map(a => ({
      id:          a.id,
      productName: a.productSize.product.name,
      category:    a.productSize.product.category,
      sizeMl:      a.productSize.sizeMl,
      type:        a.adjustmentType,
      qty:         a.quantityBottles,
      reason:      a.reason,
      approved:    a.approved,
      createdBy:   a.createdBy.name,
    }))

    // ── 6. Indent receipts ─────────────────────────────────────────────────────
    const receiptsRows = await prisma.receiptItem.findMany({
      where:   { receipt: { receivedDate: dateOnly } },
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

    // ── 7. Opening & Closing stock ─────────────────────────────────────────────
    // Find the inventory session that covers this date (if any)
    const session = await prisma.inventorySession.findFirst({
      where: { periodStart: { lte: dateOnly }, periodEnd: { gte: dateOnly } },
      orderBy: { periodStart: 'desc' },
    })

    const productSizes = await prisma.productSize.findMany({
      include: { product: true },
      orderBy: [
        { product: { category: 'asc' } },
        { product: { name: 'asc' } },
        { sizeMl: 'desc' },
      ],
    })
    const psIds = productSizes.map(ps => ps.id)

    // Opening stock — from session if available
    let openingMap = new Map<number, number>()
    if (session) {
      const openingEntries = await prisma.stockEntry.findMany({
        where: { sessionId: session.id, entryType: 'OPENING' },
      })
      openingMap = new Map(openingEntries.map(e => [e.productSizeId, e.totalBottles]))
    }

    const openingStock = productSizes
      .map(ps => {
        const total = openingMap.get(ps.id) ?? 0
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
      .filter(r => r.totalBottles > 0)

    // Stock movements for this date
    const periodStart = session?.periodStart ?? dateOnly
    const boundary    = isToday ? now : new Date(dateOnly.getTime() + 86400000 - 1)

    const [allReceiptItems, allSalesAgg, allAdjAgg] = await Promise.all([
      prisma.receiptItem.findMany({
        where: {
          productSizeId: { in: psIds },
          receipt: { receivedDate: { gte: periodStart, lte: boundary } },
        },
        select: { productSizeId: true, totalBottles: true },
      }),
      prisma.sale.groupBy({
        by:    ['productSizeId'],
        where: { productSizeId: { in: psIds }, saleDate: { gte: periodStart, lte: boundary }, quantityBottles: { gt: 0 } },
        _sum:  { quantityBottles: true },
      }),
      prisma.stockAdjustment.groupBy({
        by:    ['productSizeId'],
        where: { productSizeId: { in: psIds }, approved: true, adjustmentDate: { gte: periodStart, lte: boundary } },
        _sum:  { quantityBottles: true },
      }),
    ])

    const rcptMap = new Map<number, number>()
    for (const r of allReceiptItems) rcptMap.set(r.productSizeId, (rcptMap.get(r.productSizeId) ?? 0) + r.totalBottles)
    const saleMap = new Map(allSalesAgg.map(s => [s.productSizeId, s._sum.quantityBottles ?? 0]))
    const adjMap  = new Map(allAdjAgg.map(a => [a.productSizeId, a._sum.quantityBottles ?? 0]))

    // For single-day view without a session, limit stock movement to just this date
    const todaySaleMap = new Map<number, number>()
    const todayRcptMap = new Map<number, number>()
    if (!session) {
      const [todaySales, todayReceipts] = await Promise.all([
        prisma.sale.groupBy({
          by: ['productSizeId'],
          where: { productSizeId: { in: psIds }, saleDate: dateOnly, quantityBottles: { gt: 0 } },
          _sum: { quantityBottles: true },
        }),
        prisma.receiptItem.findMany({
          where: { productSizeId: { in: psIds }, receipt: { receivedDate: dateOnly } },
          select: { productSizeId: true, totalBottles: true },
        }),
      ])
      for (const s of todaySales) todaySaleMap.set(s.productSizeId, s._sum.quantityBottles ?? 0)
      for (const r of todayReceipts) todayRcptMap.set(r.productSizeId, (todayRcptMap.get(r.productSizeId) ?? 0) + r.totalBottles)
    }

    type ClosingRow = {
      productSizeId:   number; productName: string; category: string; sizeMl: number
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
          productSizeId: ps.id, productName: ps.product.name,
          category: String(ps.product.category), sizeMl: ps.sizeMl,
          cases, bottles, totalBottles: closing,
          value: closing * Number(ps.sellingPrice),
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
      totalSales       += amount
      totalBottlesSold += s.quantityBottles
      totalBills++
    }
    const totalExpenses  = expenses.reduce((s, e) => s + e.amount, 0)
    const closingTotal   = closingStock.reduce((s, r) => s + r.totalBottles, 0)
    const openingTotal   = openingStock.reduce((s, r) => s + r.totalBottles, 0)

    // ── 9. Cash register / galla tally ────────────────────────────────────────
    const cashRecord   = await prisma.cashRecord.findUnique({ where: { recordDate: dateOnly } })
    const bankDeposits = await prisma.bankTransaction.findMany({
      where: { txDate: dateOnly, txType: 'DEPOSIT' },
      orderBy: { createdAt: 'asc' },
    })
    const cashFlow = {
      openingRegister:    cashRecord ? Number(cashRecord.openingRegister)  : null,
      cashSales:          cashRecord ? Number(cashRecord.cashSales)         : null,
      expenses:           cashRecord ? Number(cashRecord.expenses)          : null,
      cashToLocker:       cashRecord ? Number(cashRecord.cashToLocker)      : null,
      closingRegister:    cashRecord ? Number(cashRecord.closingRegister)   : null,
      bankDeposits:       bankDeposits.map(b => ({ id: b.id, amount: Number(b.amount), notes: b.notes })),
      totalBankDeposited: bankDeposits.reduce((s, b) => s + Number(b.amount), 0),
    }

    // ── Pending bills (unsettled, created on this date) ────────────────────────
    const [pendingUnpaid, pendingTotalAgg] = await Promise.all([
      prisma.pendingBill.count({ where: { saleDate: dateOnly, settled: false } }),
      prisma.pendingBill.aggregate({ where: { saleDate: dateOnly, settled: false }, _sum: { totalAmount: true } }),
    ])
    const pendingUnpaidAmount = Number(pendingTotalAgg._sum.totalAmount ?? 0)

    return NextResponse.json({
      date: dateOnly,
      isToday,
      hasSession: !!session,
      financials: {
        totalSales, totalExpenses,
        netCash: salesByMode.CASH - totalExpenses,
        salesByMode, totalBottlesSold, totalBills,
        pendingUnpaid, pendingUnpaidAmount,
      },
      clerkBreakup,
      cashFlow,
      sales, receipts, expenses, attendance, adjustments,
      openingStock, closingStock, closingTotal, openingTotal,
    })
  } catch (error: unknown) {
    console.error('[daily-detail]', error)
    return NextResponse.json({ error: 'Failed to load daily detail' }, { status: 500 })
  }
}
