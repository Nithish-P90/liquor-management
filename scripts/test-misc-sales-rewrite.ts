import prisma from '../lib/prisma'
import {
  createMiscSalesForDate,
  listMiscSalesForDate,
  resolveMiscSalesDay,
  aggregateMiscSalesForScope,
  normalizeMiscSaleItems,
} from '../lib/misc-sales'

type MetricSnapshot = {
  listSummary: { totalAmount: number; items: number; entries: number }
  aggregateSummary: { totalAmount: number; items: number; entries: number }
  clerkStaffSummary: { totalAmount: number; items: number; entries: number }
  rawDayAggregate: { totalAmount: number; items: number; entries: number }
  dailyRouteLike: { totalAmount: number; items: number; entries: number }
  dailyDetailLike: { totalAmount: number; items: number; entries: number }
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function asNumber(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

function assertNear(actual: number, expected: number, message: string, tolerance = 0.01) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message} (expected ${expected}, got ${actual})`)
  }
}

async function takeSnapshot(scope: ReturnType<typeof resolveMiscSalesDay>, staffId: number): Promise<MetricSnapshot> {
  const [listData, aggregateSummary, groupedByStaff, rawDayAggregate, dailyGrouped, dailyDetailRows] = await Promise.all([
    listMiscSalesForDate({ dateInput: scope.isoDate }),
    aggregateMiscSalesForScope(scope),
    prisma.miscSale.groupBy({
      by: ['staffId'],
      where: { saleDate: { gte: scope.dayStart, lt: scope.nextDayStart } },
      _sum: { totalAmount: true, quantity: true },
      _count: { _all: true },
    }),
    prisma.miscSale.aggregate({
      where: { saleDate: { gte: scope.dayStart, lt: scope.nextDayStart } },
      _sum: { totalAmount: true, quantity: true },
      _count: { _all: true },
    }),
    prisma.miscSale.groupBy({
      by: ['saleDate'],
      where: { saleDate: { gte: scope.dayStart, lt: scope.nextDayStart } },
      _sum: { totalAmount: true, quantity: true },
      _count: { _all: true },
    }),
    prisma.miscSale.findMany({
      where: { saleDate: { gte: scope.dayStart, lt: scope.nextDayStart } },
      include: { item: true },
      orderBy: [{ saleTime: 'asc' }, { id: 'asc' }],
    }),
  ])

  const row = groupedByStaff.find(g => g.staffId === staffId)
  const dailyGroupRow = dailyGrouped.find(g => g.saleDate.toISOString().startsWith(scope.isoDate))

  return {
    listSummary: {
      totalAmount: round2(listData.summary.totalAmount),
      items: listData.summary.items,
      entries: listData.summary.entries,
    },
    aggregateSummary: {
      totalAmount: round2(aggregateSummary.totalAmount),
      items: aggregateSummary.items,
      entries: aggregateSummary.entries,
    },
    clerkStaffSummary: {
      totalAmount: round2(asNumber(row?._sum.totalAmount)),
      items: asNumber(row?._sum.quantity),
      entries: row?._count._all ?? 0,
    },
    rawDayAggregate: {
      totalAmount: round2(asNumber(rawDayAggregate._sum.totalAmount)),
      items: asNumber(rawDayAggregate._sum.quantity),
      entries: rawDayAggregate._count._all,
    },
    dailyRouteLike: {
      totalAmount: round2(asNumber(dailyGroupRow?._sum.totalAmount)),
      items: asNumber(dailyGroupRow?._sum.quantity),
      entries: dailyGroupRow?._count._all ?? 0,
    },
    dailyDetailLike: {
      totalAmount: round2(dailyDetailRows.reduce((sum, row) => sum + asNumber(row.totalAmount), 0)),
      items: dailyDetailRows.reduce((sum, row) => sum + row.quantity, 0),
      entries: dailyDetailRows.length,
    },
  }
}

function delta(after: MetricSnapshot, before: MetricSnapshot) {
  return {
    listSummary: {
      totalAmount: round2(after.listSummary.totalAmount - before.listSummary.totalAmount),
      items: after.listSummary.items - before.listSummary.items,
      entries: after.listSummary.entries - before.listSummary.entries,
    },
    aggregateSummary: {
      totalAmount: round2(after.aggregateSummary.totalAmount - before.aggregateSummary.totalAmount),
      items: after.aggregateSummary.items - before.aggregateSummary.items,
      entries: after.aggregateSummary.entries - before.aggregateSummary.entries,
    },
    clerkStaffSummary: {
      totalAmount: round2(after.clerkStaffSummary.totalAmount - before.clerkStaffSummary.totalAmount),
      items: after.clerkStaffSummary.items - before.clerkStaffSummary.items,
      entries: after.clerkStaffSummary.entries - before.clerkStaffSummary.entries,
    },
    rawDayAggregate: {
      totalAmount: round2(after.rawDayAggregate.totalAmount - before.rawDayAggregate.totalAmount),
      items: after.rawDayAggregate.items - before.rawDayAggregate.items,
      entries: after.rawDayAggregate.entries - before.rawDayAggregate.entries,
    },
    dailyRouteLike: {
      totalAmount: round2(after.dailyRouteLike.totalAmount - before.dailyRouteLike.totalAmount),
      items: after.dailyRouteLike.items - before.dailyRouteLike.items,
      entries: after.dailyRouteLike.entries - before.dailyRouteLike.entries,
    },
    dailyDetailLike: {
      totalAmount: round2(after.dailyDetailLike.totalAmount - before.dailyDetailLike.totalAmount),
      items: after.dailyDetailLike.items - before.dailyDetailLike.items,
      entries: after.dailyDetailLike.entries - before.dailyDetailLike.entries,
    },
  }
}

async function run() {
  const tests: Array<{ name: string; pass: boolean; detail?: string }> = []
  const tempBarcodeA = `MISC-TEST-A-${Date.now()}`
  const tempBarcodeB = `MISC-TEST-B-${Date.now()}`
  const cleanupSaleIds: number[] = []
  const cleanupItemIds: number[] = []

  try {
    const scope = resolveMiscSalesDay(new Date().toISOString().slice(0, 10))

    const activeStaff = await prisma.staff.findFirst({
      where: { active: true },
      select: { id: true, role: true, name: true },
      orderBy: { id: 'asc' },
    })
    assert(Boolean(activeStaff), 'No active staff found in DB for misc sale attribution tests')

    try {
      resolveMiscSalesDay('18-04-2026')
      tests.push({ name: 'rejects invalid date format', pass: false, detail: 'Expected throw, but resolved successfully' })
    } catch {
      tests.push({ name: 'rejects invalid date format', pass: true })
    }

    try {
      normalizeMiscSaleItems([])
      tests.push({ name: 'rejects empty items payload', pass: false, detail: 'Expected throw for empty array' })
    } catch {
      tests.push({ name: 'rejects empty items payload', pass: true })
    }

    try {
      normalizeMiscSaleItems([{ itemId: 1, quantity: 0 }])
      tests.push({ name: 'rejects non-positive quantity', pass: false, detail: 'Expected throw for invalid quantity' })
    } catch {
      tests.push({ name: 'rejects non-positive quantity', pass: true })
    }

    const itemA = await prisma.miscItem.create({
      data: {
        barcode: tempBarcodeA,
        name: 'Test Snacks A',
        category: 'SNACKS',
        price: 17,
      },
      select: { id: true, price: true },
    })
    cleanupItemIds.push(itemA.id)

    const itemB = await prisma.miscItem.create({
      data: {
        barcode: tempBarcodeB,
        name: 'Test Cups B',
        category: 'CUPS',
        price: 9,
      },
      select: { id: true, price: true },
    })
    cleanupItemIds.push(itemB.id)

    try {
      await createMiscSalesForDate({
        saleDateInput: scope.isoDate,
        requestedStaffId: activeStaff!.id,
        sessionStaffId: activeStaff!.id,
        itemsInput: [{ itemId: 99999999, quantity: 1 }],
      })
      tests.push({ name: 'rejects unknown misc item ids', pass: false, detail: 'Expected throw for unknown item' })
    } catch {
      tests.push({ name: 'rejects unknown misc item ids', pass: true })
    }

    const before = await takeSnapshot(scope, activeStaff!.id)

    const created = await createMiscSalesForDate({
      saleDateInput: scope.isoDate,
      requestedStaffId: activeStaff!.id,
      sessionStaffId: activeStaff!.id,
      itemsInput: [
        { itemId: itemA.id, quantity: 2 },
        { itemId: itemA.id, quantity: 1 },
        { itemId: itemB.id, quantity: 4 },
      ],
    })

    const createdTotalExpected = round2(3 * asNumber(itemA.price) + 4 * asNumber(itemB.price))
    tests.push({
      name: 'creates misc sales with server-side pricing',
      pass: round2(created.createdTotals.totalAmount) === createdTotalExpected,
      detail: `Expected ${createdTotalExpected}, got ${created.createdTotals.totalAmount}`,
    })

    const createdRows = await prisma.miscSale.findMany({
      where: {
        saleDate: { gte: scope.dayStart, lt: scope.nextDayStart },
        itemId: { in: [itemA.id, itemB.id] },
        staffId: activeStaff!.id,
      },
      orderBy: [{ id: 'desc' }],
      take: 2,
      select: { id: true },
    })
    cleanupSaleIds.push(...createdRows.map(row => row.id))

    const after = await takeSnapshot(scope, activeStaff!.id)
    const d = delta(after, before)

    const expectedDelta = {
      totalAmount: created.createdTotals.totalAmount,
      items: created.createdTotals.items,
      entries: created.createdTotals.entries,
    }

    const metricChecks: Array<{ name: string; snap: { totalAmount: number; items: number; entries: number } }> = [
      { name: 'misc-sale page summary pipeline', snap: d.listSummary },
      { name: 'pos summary misc metrics pipeline', snap: d.aggregateSummary },
      { name: 'cash day-summary misc metrics pipeline', snap: d.rawDayAggregate },
      { name: 'dashboard misc metric pipeline', snap: d.rawDayAggregate },
      { name: 'clerk billing misc-by-staff pipeline', snap: d.clerkStaffSummary },
      { name: 'daily report list misc pipeline', snap: d.dailyRouteLike },
      { name: 'daily detail misc table pipeline', snap: d.dailyDetailLike },
    ]

    for (const check of metricChecks) {
      try {
        assertNear(check.snap.totalAmount, expectedDelta.totalAmount, `${check.name}: amount delta mismatch`)
        assert(check.snap.items === expectedDelta.items, `${check.name}: item delta mismatch (expected ${expectedDelta.items}, got ${check.snap.items})`)
        assert(check.snap.entries === expectedDelta.entries, `${check.name}: entry delta mismatch (expected ${expectedDelta.entries}, got ${check.snap.entries})`)
        tests.push({ name: check.name, pass: true })
      } catch (error: unknown) {
        tests.push({
          name: check.name,
          pass: false,
          detail: error instanceof Error ? error.message : 'Unknown mismatch',
        })
      }
    }

    const failed = tests.filter(test => !test.pass)
    console.log('--- Misc Sales Rewrite Verification ---')
    console.log(`Date: ${scope.isoDate}`)
    console.log(`Staff: ${activeStaff!.name} (#${activeStaff!.id}, ${activeStaff!.role})`)
    console.log(`Checks: ${tests.length}, Passed: ${tests.length - failed.length}, Failed: ${failed.length}`)
    for (const test of tests) {
      console.log(`- [${test.pass ? 'PASS' : 'FAIL'}] ${test.name}${test.detail ? ` :: ${test.detail}` : ''}`)
    }

    if (failed.length > 0) {
      process.exitCode = 1
    }
  } catch (error: unknown) {
    console.error('Fatal test runner error:', error)
    process.exitCode = 1
  } finally {
    if (cleanupSaleIds.length > 0) {
      await prisma.miscSale.deleteMany({ where: { id: { in: cleanupSaleIds } } })
    }
    if (cleanupItemIds.length > 0) {
      await prisma.miscItem.deleteMany({ where: { id: { in: cleanupItemIds } } })
    }
    await prisma.$disconnect()
  }
}

void run()
