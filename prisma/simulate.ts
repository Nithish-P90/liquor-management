/**
 * simulate.ts
 * ────────────────────────────────────────────────────────────────
 * Wipes all transactional data, then creates 5 complete past days
 * of business activity:
 *   • Inventory sessions with opening + closing stock snapshots
 *   • KSBCL indent → receipt on Day 2 and Day 4
 *   • Realistic daily sales (80-130 bottles/day)
 *   • Expenses (wages, ice, cleaning…)
 *   • Cash register entries with locker transfer
 *   • Staff attendance (check-in / check-out)
 *   • Bank deposit on Day 3
 *   • Closing stock → next day opening rollover chain
 *
 * Run: npm run simulate
 */

import { PrismaClient, PaymentMode } from '@prisma/client'

const prisma = new PrismaClient()

// ── Tiny helpers ──────────────────────────────────────────────────────────────

/** Returns a Date at UTC noon for N days ago */
function daysAgoNoon(n: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0))
}

/** Returns a DateTime on a given UTC-noon day at the specified hour:minute */
function timeOnDay(noon: Date, hour: number, minute: number): Date {
  return new Date(Date.UTC(noon.getUTCFullYear(), noon.getUTCMonth(), noon.getUTCDate(), hour, minute, 0))
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ── Simulation config ─────────────────────────────────────────────────────────

/**
 * Initial opening stock on Day 1.
 * [itemCode, sizeMl, bottles]
 */
const INITIAL_OPENING: [string, number, number][] = [
  // BRANDY
  ['B001', 750,  36],  ['B001', 375,  96],  ['B001', 180,  96],  ['B001', 90,  192],
  ['B002', 750,  24],  ['B002', 375,  72],  ['B002', 180,  48],
  ['B003', 750,  12],  ['B003', 375,  24],
  ['B007', 750,  12],  ['B007', 375,  24],
  // WHISKY
  ['W001', 750,  24],  ['W001', 375,  72],  ['W001', 180,  48],
  ['W002', 750,  24],  ['W002', 375,  24],  ['W002', 180,  24],
  ['W013', 750,  12],  ['W013', 375,  24],
  ['W005', 750,  12],  ['W016', 750,  12],
  ['W022', 750,  12],  ['W022', 375,  12],
  // RUM
  ['R001', 750,  24],  ['R001', 375,  48],  ['R001', 180,  48],
  ['R003', 750,  12],  ['R003', 375,  12],
  ['R002', 750,  12],
  // VODKA
  ['V002', 750,  12],  ['V002', 375,  24],
  ['V005', 750,  12],
  // BEER
  ['BR001', 650, 84],  ['BR002', 650, 72],  ['BR005', 650, 36],
  ['BR007', 650, 24],  ['BR008', 650, 24],  ['BR012', 650, 12],
  ['BR015', 650, 12],
  // BEVERAGES
  ['BV001', 600, 48],  ['BV001', 500, 24],
  ['BV002', 600, 48],
  ['BV003', 1000, 24], ['BV003', 500, 48],
]

/**
 * Daily sales pattern.
 * [itemCode, sizeMl, minQty, maxQty] — sells this many bottles each day.
 */
const SALES_PATTERN: [string, number, number, number][] = [
  // Beer — highest volume
  ['BR001', 650, 12, 22],
  ['BR002', 650, 10, 18],
  ['BR005', 650,  4,  9],
  ['BR007', 650,  3,  7],
  ['BR008', 650,  2,  6],
  // Brandy 90ml / 180ml — most popular nip sizes
  ['B001',  90,  18, 32],
  ['B001', 180,  12, 22],
  ['B001', 375,   6, 12],
  ['B001', 750,   2,  5],
  ['B002', 375,   5, 10],
  ['B002', 180,   4,  9],
  // Whisky
  ['W001', 180,   5, 10],
  ['W001', 375,   3,  7],
  ['W001', 750,   1,  4],
  ['W002', 750,   2,  5],
  ['W013', 375,   1,  3],
  // Rum
  ['R001', 180,   4,  9],
  ['R001', 375,   2,  6],
  ['R003', 750,   1,  3],
  // Vodka
  ['V002', 375,   1,  4],
  // Beverages
  ['BV001', 600,  5, 12],
  ['BV002', 600,  4, 10],
  ['BV003', 1000, 3,  7],
]

// Weighted payment modes (CASH heavy, as is typical for a liquor shop)
const PAYMENT_MODES: PaymentMode[] = [
  'CASH', 'CASH', 'CASH', 'CASH',
  'UPI',  'UPI',  'UPI',
  'CARD',
  'CREDIT',
]

const EXPENSES = [
  { particulars: 'Staff Wages',             category: 'WAGES',       min: 900,  max: 1300 },
  { particulars: 'Ice Purchase',            category: 'MATERIALS',   min: 150,  max: 350  },
  { particulars: 'Cleaning & Sanitation',   category: 'MAINTENANCE', min: 80,   max: 180  },
  { particulars: 'Carry Bags / Packing',    category: 'MATERIALS',   min: 60,   max: 140  },
  { particulars: 'Auto / Transport Charges',category: 'TRANSPORT',   min: 100,  max: 280  },
  { particulars: 'Electricity (meter)',     category: 'UTILITIES',   min: 250,  max: 500  },
  { particulars: 'Miscellaneous',           category: 'OTHER',       min: 50,   max: 200  },
]

// Indent deliveries — [dayNumber, indentNumber, invoiceNumber, items]
const INDENTS = [
  {
    dayNum: 2,
    indentNumber:  'IND/2024/0847',
    invoiceNumber: 'KSBCL/INV/2024/5612',
    items: [
      { itemCode: 'B001', sizeMl:  90, cases: 2 },  // +192 btls
      { itemCode: 'B001', sizeMl: 180, cases: 2 },  // + 96 btls
      { itemCode: 'B001', sizeMl: 375, cases: 2 },  // + 48 btls
      { itemCode: 'BR001', sizeMl: 650, cases: 3 }, // + 36 btls
      { itemCode: 'BR002', sizeMl: 650, cases: 2 }, // + 24 btls
      { itemCode: 'W001', sizeMl: 375, cases: 1 },  // + 24 btls
    ],
  },
  {
    dayNum: 4,
    indentNumber:  'IND/2024/0863',
    invoiceNumber: 'KSBCL/INV/2024/5788',
    items: [
      { itemCode: 'B001', sizeMl: 750, cases: 2 },  // + 24 btls
      { itemCode: 'B001', sizeMl:  90, cases: 3 },  // +288 btls
      { itemCode: 'B002', sizeMl: 375, cases: 2 },  // + 48 btls
      { itemCode: 'W002', sizeMl: 750, cases: 2 },  // + 24 btls
      { itemCode: 'R001', sizeMl: 750, cases: 2 },  // + 24 btls
      { itemCode: 'BR005', sizeMl: 650, cases: 3 }, // + 36 btls
      { itemCode: 'BR001', sizeMl: 650, cases: 2 }, // + 24 btls
    ],
  },
]

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n════════════════════════════════════════════════════')
  console.log('  Mahavishnu Wines — 5-Day Business Simulation')
  console.log('════════════════════════════════════════════════════\n')

  // ── Step 1: Wipe all transactional data ──────────────────────────────────
  console.log('🗑  Wiping existing transactional data…')
  await prisma.varianceRecord.deleteMany()
  await prisma.stockAdjustment.deleteMany()
  await prisma.sale.deleteMany()
  await prisma.stockEntry.deleteMany()
  await prisma.receiptItem.deleteMany()
  await prisma.receipt.deleteMany()
  await prisma.indentItem.deleteMany()
  await prisma.indent.deleteMany()
  await prisma.inventorySession.deleteMany()
  await prisma.expenditure.deleteMany()
  await prisma.cashRecord.deleteMany()
  await prisma.bankTransaction.deleteMany()
  await prisma.attendanceLog.deleteMany()
  console.log('✓  Database clean\n')

  // ── Step 2: Load reference data ──────────────────────────────────────────
  const allStaff = await prisma.staff.findMany({ where: { active: true }, orderBy: { id: 'asc' } })
  if (allStaff.length === 0) {
    throw new Error('No staff found — run `npm run seed` first.')
  }
  const admin      = allStaff.find(s => s.role === 'ADMIN') ?? allStaff[0]
  // Treat everyone except ADMIN as floor staff for simulation
  const floorStaff = allStaff.filter(s => s.role !== 'ADMIN')
  const salesStaff = floorStaff.length > 0 ? floorStaff : allStaff

  const productSizes = await prisma.productSize.findMany({
    include: { product: true },
    orderBy: [{ product: { category: 'asc' } }, { sizeMl: 'desc' }],
  })
  if (productSizes.length === 0) {
    throw new Error('No products found — run `npm run seed` first.')
  }

  // itemCode-sizeMl → ProductSize lookup
  const psByKey = new Map(productSizes.map(p => [`${p.product.itemCode}-${p.sizeMl}`, p]))
  const getPS = (itemCode: string, sizeMl: number) => psByKey.get(`${itemCode}-${sizeMl}`)

  // ── Step 3: Build initial running stock map ───────────────────────────────
  // runningStock tracks the real-time bottle count across all days
  const runningStock = new Map<number, number>()
  for (const ps of productSizes) runningStock.set(ps.id, 0)

  for (const [code, size, qty] of INITIAL_OPENING) {
    const ps = getPS(code, size)
    if (ps) runningStock.set(ps.id, qty)
    else    console.warn(`  ⚠  Product not found: ${code} ${size}ml`)
  }

  // ── Step 4: Simulate each day ─────────────────────────────────────────────
  const NUM_DAYS = 5
  // Days run from 5 days ago to 1 day ago (all fully completed past days)
  const dates = Array.from({ length: NUM_DAYS }, (_, i) => daysAgoNoon(NUM_DAYS - i))

  let prevClosingRegister = 5000 // ₹5,000 opening galla cash
  const dayReports: any[] = []

  for (let dayIdx = 0; dayIdx < NUM_DAYS; dayIdx++) {
    const dayNum = dayIdx + 1
    const date   = dates[dayIdx]
    const label  = date.toISOString().slice(0, 10)

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`  Day ${dayNum}  ·  ${label}`)
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

    // ── 4a. Inventory session ───────────────────────────────────────────────
    const session = await prisma.inventorySession.create({
      data: { periodStart: date, periodEnd: date, staffId: admin.id },
    })

    // ── 4b. OPENING stock snapshot ─────────────────────────────────────────
    let openingTotal = 0
    for (const [psId, qty] of Array.from(runningStock.entries())) {
      if (qty === 0) continue
      const ps = productSizes.find(p => p.id === psId)!
      await prisma.stockEntry.create({
        data: {
          sessionId:     session.id,
          productSizeId: psId,
          entryType:     'OPENING',
          cases:         Math.floor(qty / ps.bottlesPerCase),
          bottles:       qty % ps.bottlesPerCase,
          totalBottles:  qty,
        },
      })
      openingTotal += qty
    }
    console.log(`  📦 Opening stock : ${openingTotal.toLocaleString('en-IN')} bottles`)

    // ── 4c. KSBCL indent + receipt (Days 2 and 4) ──────────────────────────
    let indentBottlesReceived = 0
    const indentDef = INDENTS.find(d => d.dayNum === dayNum)
    if (indentDef) {
      const indent = await prisma.indent.create({
        data: {
          indentNumber:  indentDef.indentNumber,
          invoiceNumber: indentDef.invoiceNumber,
          retailerId:    'KA-BNG-07458',
          retailerName:  'Mahavishnu Wines',
          indentDate:    date,
          pdfPath:       `/uploads/indents/${indentDef.indentNumber}.pdf`,
          status:        'FULLY_RECEIVED',
        },
      })

      for (const item of indentDef.items) {
        const ps = getPS(item.itemCode, item.sizeMl)
        if (!ps) continue
        const rateCase   = Math.round(Number(ps.mrp) * ps.bottlesPerCase * 0.82)
        await prisma.indentItem.create({
          data: {
            indentId:        indent.id,
            productId:       ps.productId,
            productSizeId:   ps.id,
            ratePerCase:     rateCase,
            isRationed:      false,
            indentCases:     item.cases,
            indentBottles:   0,
            indentAmount:    rateCase * item.cases,
            cnfCases:        item.cases,
            cnfBottles:      0,
            cnfAmount:       rateCase * item.cases,
            receivedCases:   item.cases,
            receivedBottles: 0,
          },
        })
      }

      const receipt = await prisma.receipt.create({
        data: {
          indentId:    indent.id,
          receivedDate: date,
          staffId:     admin.id,
          notes:       `KSBCL lorry delivery — ${indentDef.indentNumber}`,
        },
      })

      for (const item of indentDef.items) {
        const ps = getPS(item.itemCode, item.sizeMl)
        if (!ps) continue
        const total = item.cases * ps.bottlesPerCase
        await prisma.receiptItem.create({
          data: {
            receiptId:       receipt.id,
            productSizeId:   ps.id,
            casesReceived:   item.cases,
            bottlesReceived: 0,
            totalBottles:    total,
          },
        })
        runningStock.set(ps.id, (runningStock.get(ps.id) ?? 0) + total)
        indentBottlesReceived += total
      }

      console.log(`  🚛 Indent ${indentDef.indentNumber}: +${indentBottlesReceived} bottles received`)
    }

    // ── 4d. Sales ───────────────────────────────────────────────────────────
    let totalCash = 0, totalUpi = 0, totalCard = 0, totalCredit = 0
    let totalBottlesSold = 0, billCount = 0

    for (const [code, sizeMl, minQty, maxQty] of SALES_PATTERN) {
      const ps        = getPS(code, sizeMl)
      if (!ps) continue
      const available = runningStock.get(ps.id) ?? 0
      if (available === 0) continue

      const qty = Math.min(rand(minQty, maxQty), available)
      if (qty === 0) continue

      // Split into 2–5 separate bills (realistic counter behaviour)
      const numBills = Math.min(qty, rand(2, 5))
      let remaining  = qty

      for (let b = 0; b < numBills && remaining > 0; b++) {
        const billQty = b === numBills - 1
          ? remaining
          : rand(1, Math.max(1, Math.floor(remaining * 0.6)))
        remaining -= billQty

        const mode    = pick(PAYMENT_MODES)
        const price   = Number(ps.sellingPrice)
        const amount  = price * billQty

        // Spread through business hours 10:00–22:00
        const hour    = rand(10, 21)
        const minute  = rand(0, 59)

        await prisma.sale.create({
          data: {
            saleDate:        date,
            saleTime:        timeOnDay(date, hour, minute),
            staffId:         pick(salesStaff).id,
            productSizeId:   ps.id,
            quantityBottles: billQty,
            sellingPrice:    price,
            totalAmount:     amount,
            paymentMode:     mode,
            scanMethod:      'BARCODE_USB',
          },
        })

        billCount++
        totalBottlesSold += billQty
        if (mode === 'CASH')   totalCash   += amount
        else if (mode === 'UPI')    totalUpi    += amount
        else if (mode === 'CARD')   totalCard   += amount
        else if (mode === 'CREDIT') totalCredit += amount
      }

      runningStock.set(ps.id, available - qty)
    }

    const totalSales = totalCash + totalUpi + totalCard + totalCredit
    console.log(`  🧾 Sales         : ${billCount} bills · ${totalBottlesSold} bottles · ₹${totalSales.toLocaleString('en-IN')}`)
    console.log(`     Cash ₹${totalCash.toLocaleString('en-IN')}  UPI ₹${totalUpi.toLocaleString('en-IN')}  Card ₹${totalCard.toLocaleString('en-IN')}  Credit ₹${totalCredit.toLocaleString('en-IN')}`)

    // ── 4e. Expenses ────────────────────────────────────────────────────────
    const numExp      = rand(2, 3)
    const expPicked   = [...EXPENSES].sort(() => Math.random() - 0.5).slice(0, numExp)
    let totalExpenses = 0

    for (const exp of expPicked) {
      const amount = rand(exp.min, exp.max)
      await prisma.expenditure.create({
        data: { expDate: date, particulars: exp.particulars, category: exp.category, amount },
      })
      totalExpenses += amount
    }
    console.log(`  💸 Expenses      : ${numExp} entries · ₹${totalExpenses.toLocaleString('en-IN')}`)

    // ── 4f. Cash register / Galla ────────────────────────────────────────────
    const cashToLocker      = Math.max(0, Math.floor((totalCash - totalExpenses) * 0.9))
    const closingRegister   = Math.max(0, prevClosingRegister + totalCash - totalExpenses - cashToLocker)

    await prisma.cashRecord.create({
      data: {
        recordDate:      date,
        openingRegister: prevClosingRegister,
        cashSales:       totalCash,
        expenses:        totalExpenses,
        cashToLocker,
        closingRegister,
        cardSales:       totalCard,
        upiSales:        totalUpi,
        creditSales:     totalCredit,
        notes:           `Day ${dayNum} simulation`,
      },
    })
    console.log(`  💰 Cash register : Galla ₹${prevClosingRegister}→₹${closingRegister}  Locker +₹${cashToLocker.toLocaleString('en-IN')}`)
    prevClosingRegister = closingRegister

    // ── 4g. Bank deposit (Day 3) ────────────────────────────────────────────
    if (dayNum === 3) {
      const deposit = 60000
      await prisma.bankTransaction.create({
        data: { txDate: date, txType: 'DEPOSIT', amount: deposit, notes: 'Weekly locker → bank deposit' },
      })
      console.log(`  🏦 Bank deposit  : ₹${deposit.toLocaleString('en-IN')}`)
    }

    // ── 4h. Staff attendance ────────────────────────────────────────────────
    for (const s of allStaff) {
      const checkIn  = timeOnDay(date, 9, rand(20, 40))
      const checkOut = timeOnDay(date, 22, rand(10, 50))
      await prisma.attendanceLog.create({
        data: { staffId: s.id, date, checkIn, checkOut, status: 'PRESENT' },
      })
    }
    console.log(`  👥 Attendance    : ${allStaff.length} staff present`)

    // ── 4i. CLOSING stock snapshot ──────────────────────────────────────────
    let closingTotal = 0
    for (const [psId, qty] of Array.from(runningStock.entries())) {
      const ps = productSizes.find(p => p.id === psId)!
      await prisma.stockEntry.create({
        data: {
          sessionId:     session.id,
          productSizeId: psId,
          entryType:     'CLOSING',
          cases:         Math.floor(qty / ps.bottlesPerCase),
          bottles:       qty % ps.bottlesPerCase,
          totalBottles:  qty,
        },
      })
      closingTotal += qty
    }
    console.log(`  📦 Closing stock : ${closingTotal.toLocaleString('en-IN')} bottles`)

    dayReports.push({
      dayNum, date: label,
      openingTotal, indentBottlesReceived, totalBottlesSold, closingTotal,
      totalSales, totalExpenses, totalCash, totalUpi, totalCard, totalCredit,
      billCount,
    })
  }

  // ── Step 5: Final verification report ─────────────────────────────────────
  console.log('\n\n════════════════════════════════════════════════════')
  console.log('  Verification Report')
  console.log('════════════════════════════════════════════════════')
  console.log(
    `${'Day'.padEnd(5)} ${'Date'.padEnd(12)} ${'Opening'.padStart(8)} ${'Received'.padStart(9)} ${'Sold'.padStart(7)} ${'Closing'.padStart(8)} ${'Sales ₹'.padStart(12)} ${'Chain'.padStart(8)}`
  )
  console.log('─'.repeat(80))

  const sessions = await prisma.inventorySession.findMany({ orderBy: { periodStart: 'asc' } })

  for (let i = 0; i < sessions.length; i++) {
    const s   = sessions[i]
    const rep = dayReports[i]

    const closingAgg = await prisma.stockEntry.aggregate({
      where: { sessionId: s.id, entryType: 'CLOSING' }, _sum: { totalBottles: true },
    })
    const openingAgg = await prisma.stockEntry.aggregate({
      where: { sessionId: s.id, entryType: 'OPENING' }, _sum: { totalBottles: true },
    })

    let chainOk = '—'
    if (i > 0) {
      const prevClosing = await prisma.stockEntry.aggregate({
        where: { sessionId: sessions[i - 1].id, entryType: 'CLOSING' }, _sum: { totalBottles: true },
      })
      const prevC = prevClosing._sum.totalBottles ?? 0
      const thisO = openingAgg._sum.totalBottles ?? 0
      chainOk = prevC === thisO ? '✓ MATCH' : `✗ ${prevC}≠${thisO}`
    }

    console.log(
      `${String(i + 1).padEnd(5)} ${rep.date.padEnd(12)} ` +
      `${String(rep.openingTotal).padStart(8)} ` +
      `${String(rep.indentBottlesReceived > 0 ? '+' + rep.indentBottlesReceived : '').padStart(9)} ` +
      `${String(rep.totalBottlesSold).padStart(7)} ` +
      `${String(closingAgg._sum.totalBottles ?? 0).padStart(8)} ` +
      `${('₹' + rep.totalSales.toLocaleString('en-IN')).padStart(12)} ` +
      `${chainOk.padStart(8)}`
    )
  }

  console.log('─'.repeat(80))

  const grandSales = dayReports.reduce((s, d) => s + d.totalSales, 0)
  const grandExp   = dayReports.reduce((s, d) => s + d.totalExpenses, 0)
  const grandBtls  = dayReports.reduce((s, d) => s + d.totalBottlesSold, 0)
  const grandBills = dayReports.reduce((s, d) => s + d.billCount, 0)

  console.log(`\n  5-day totals: ${grandBills} bills · ${grandBtls} bottles sold`)
  console.log(`  Revenue: ₹${grandSales.toLocaleString('en-IN')}  Expenses: ₹${grandExp.toLocaleString('en-IN')}  Net: ₹${(grandSales - grandExp).toLocaleString('en-IN')}`)
  console.log('\n✅  Simulation complete. Open the Daily Ledger to verify.\n')
}

main()
  .catch(e => { console.error('\n❌  Simulation failed:', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
