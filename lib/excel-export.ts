import * as XLSX from 'xlsx'
import prisma from './prisma'

// ── IML sizes and their case configurations ──────────────────────────────────
const IML_SIZES = [750, 375, 180, 90, 60] as const
const IML_LABELS: Record<number, string> = {
  750: '750 ML', 375: '375 ML', 180: '180 ML', 90: '90 ML', 60: '60 ML',
}
const IML_CASE_LABELS: Record<number, string> = {
  750: 'CASES*12', 375: 'CASES*24', 180: 'CASES*48', 90: 'CASES*96', 60: 'BOX*25',
}

// Beer sizes
const BEER_SIZES = [650, 500, 330] as const
const BEER_LABELS: Record<number, string> = {
  650: '650 ML', 500: '500 ML TIN(CAN)', 330: '330 ML',
}
const BEER_CASE_LABELS: Record<number, string> = {
  650: 'CASES*12', 500: 'CASES*24', 330: 'CASES*24',
}

// Beverage sizes
const BEV_SIZES = [2000, 1000, 600, 500, 250] as const
const BEV_LABELS: Record<number, string> = {
  2000: '2 LTRS', 1000: '1 LTRS', 600: '500-600 ML', 500: '500-600 ML', 250: '250 ML',
}

// IML categories (non-beer, non-beverage)
const IML_CATEGORIES = ['BRANDY', 'WHISKY', 'RUM', 'VODKA', 'GIN', 'WINE', 'PREMIX']

function splitToCV(totalBottles: number, bottlesPerCase: number): { cases: number; bottles: number } {
  return {
    cases: Math.floor(totalBottles / bottlesPerCase),
    bottles: totalBottles % bottlesPerCase,
  }
}

export async function generateStockSheet(sessionId: number) {
  const session = await prisma.inventorySession.findUnique({
    where: { id: sessionId },
    include: { stockEntries: { include: { productSize: { include: { product: true } } } } },
  })
  if (!session) throw new Error('Session not found')

  // Fetch products by category
  const imlProducts = await prisma.product.findMany({
    where: { category: { in: IML_CATEGORIES as any } },
    include: { sizes: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })

  const beerProducts = await prisma.product.findMany({
    where: { category: 'BEER' },
    include: { sizes: true },
    orderBy: { name: 'asc' },
  })

  const bevProducts = await prisma.product.findMany({
    where: { category: 'BEVERAGE' },
    include: { sizes: true },
    orderBy: { name: 'asc' },
  })

  const dateStr = `${session.periodStart.toLocaleDateString('en-IN')} To ${session.periodEnd.toLocaleDateString('en-IN')}`

  // ── Receipts data ─────────────────────────────────────────────────────────
  const receipts = await prisma.receiptItem.findMany({
    where: { receipt: { receivedDate: { gte: session.periodStart, lte: session.periodEnd } } },
    include: { productSize: true },
  })
  const receiptMap = new Map<string, { cases: number; bottles: number }>()
  for (const r of receipts) {
    const key = `${r.productSize.productId}-${r.productSize.sizeMl}`
    const prev = receiptMap.get(key) ?? { cases: 0, bottles: 0 }
    receiptMap.set(key, {
      cases: prev.cases + r.casesReceived,
      bottles: prev.bottles + r.bottlesReceived,
    })
  }

  // ── Sales data ────────────────────────────────────────────────────────────
  const sales = await prisma.sale.groupBy({
    by: ['productSizeId'],
    where: { saleDate: { gte: session.periodStart, lte: session.periodEnd } },
    _sum: { quantityBottles: true, totalAmount: true },
  })
  const salesPrices = await prisma.productSize.findMany({
    where: { id: { in: sales.map(s => s.productSizeId) } },
  })
  const salesMap = new Map<string, { bottles: number; amount: number }>()
  for (const s of sales) {
    const ps = salesPrices.find(p => p.id === s.productSizeId)
    if (!ps) continue
    const key = `${ps.productId}-${ps.sizeMl}`
    salesMap.set(key, {
      bottles: s._sum.quantityBottles ?? 0,
      amount: Number(s._sum.totalAmount ?? 0),
    })
  }

  // ── Helper to get entry data ──────────────────────────────────────────────
  function getEntry(productId: number, sizeMl: number, type: 'OPENING' | 'CLOSING') {
    const entry = session!.stockEntries.find(
      e => e.productSize.productId === productId && e.productSize.sizeMl === sizeMl && e.entryType === type
    )
    return entry ? { cases: entry.cases, bottles: entry.bottles } : null
  }

  // ── Sheet builder for IML products ────────────────────────────────────────
  function buildIMLSheet(
    title: string,
    products: typeof imlProducts,
    getValues: (productId: number, sizeMl: number) => { cases: number; bottles: number } | null,
    includeBottles = true
  ) {
    const headers1 = ['Mahavishnu ', '', `${title}                                                                                 `]
    for (let i = 3; i < (includeBottles ? IML_SIZES.length * 2 + 2 : IML_SIZES.length + 2); i++) headers1.push('')

    const headers2 = ['', '']
    const headers3 = ['SL.', 'PRODUCT NAME']
    for (const size of IML_SIZES) {
      if (includeBottles) {
        headers2.push(IML_LABELS[size], '')
        headers3.push(IML_CASE_LABELS[size], 'BTLS')
      } else {
        headers2.push(IML_LABELS[size])
        headers3.push(IML_CASE_LABELS[size])
      }
    }

    const rows: (string | number)[][] = [headers1, headers2, headers3]
    let sl = 1
    for (const product of products) {
      const row: (string | number)[] = [sl++, product.name]
      for (const sizeMl of IML_SIZES) {
        const vals = getValues(product.id, sizeMl)
        if (includeBottles) {
          row.push(vals?.cases ?? 0, vals?.bottles ?? 0)
        } else {
          row.push(vals?.cases ?? 0)
        }
      }
      rows.push(row)
    }
    return rows
  }

  // ── Sheet builder for Beer ────────────────────────────────────────────────
  function buildBeerSection(
    title: string,
    getValues: (productId: number, sizeMl: number) => { cases: number; bottles: number } | null,
    includeBottles = true
  ) {
    const rows: (string | number)[][] = [
      ['BEERS', '', title]
    ]

    const headers2 = ['', '']
    const headers3 = ['SL.', 'PRODUCT NAME']
    for (const size of BEER_SIZES) {
      if (includeBottles) {
        headers2.push(BEER_LABELS[size], '')
        headers3.push(BEER_CASE_LABELS[size], 'BTLS')
      } else {
        headers2.push(BEER_LABELS[size])
        headers3.push(BEER_CASE_LABELS[size])
      }
    }
    rows.push(headers2, headers3)

    let sl = 1
    for (const product of beerProducts) {
      const row: (string | number)[] = [sl++, product.name]
      for (const sizeMl of BEER_SIZES) {
        const vals = getValues(product.id, sizeMl)
        if (includeBottles) {
          row.push(vals?.cases ?? 0, vals?.bottles ?? 0)
        } else {
          row.push(vals?.cases ?? 0)
        }
      }
      rows.push(row)
    }
    return rows
  }

  // ── Sheet builder for Beverages ───────────────────────────────────────────
  function buildBevSection(
    title: string,
    getValues: (productId: number, sizeMl: number) => { cases: number; bottles: number } | null,
    includeBottles = true
  ) {
    const rows: (string | number)[][] = [
      ['BEVERAGES', '', title]
    ]

    const uSizes = [2000, 1000, 600, 250] as const
    const headers2 = ['', '']
    const headers3 = ['SL.', 'PRODUCT NAME']
    for (const size of uSizes) {
      if (includeBottles) {
        headers2.push(BEV_LABELS[size] ?? `${size}ml`, '')
        headers3.push(size === 2000 ? 'CASES*9' : size === 1000 ? 'CASES*12' : size === 600 ? 'CASES*24' : 'CASES*30', 'BTLS')
      } else {
        headers2.push(BEV_LABELS[size] ?? `${size}ml`)
        headers3.push(size === 2000 ? 'CASES*9' : size === 1000 ? 'CASES*12' : size === 600 ? 'CASES*24' : 'CASES*30')
      }
    }
    rows.push(headers2, headers3)

    let sl = 1
    for (const product of bevProducts) {
      const row: (string | number)[] = [sl++, product.name]
      for (const sizeMl of uSizes) {
        // Match 500ml and 600ml to the same column
        const matchSizes = sizeMl === 600 ? [500, 600] : [sizeMl]
        let vals: { cases: number; bottles: number } | null = null
        for (const ms of matchSizes) {
          const v = getValues(product.id, ms)
          if (v) { vals = v; break }
        }
        if (includeBottles) {
          row.push(vals?.cases ?? 0, vals?.bottles ?? 0)
        } else {
          row.push(vals?.cases ?? 0)
        }
      }
      rows.push(row)
    }
    return rows
  }

  // ── Combine IML + Beer + Bev into a full sheet ────────────────────────────
  function fullSheet(
    title: string,
    getValues: (productId: number, sizeMl: number) => { cases: number; bottles: number } | null,
    includeBottles = true
  ) {
    const imlRows = buildIMLSheet(title, imlProducts, getValues, includeBottles)
    const beerRows = buildBeerSection(title, getValues, includeBottles)
    const bevRows = buildBevSection(title, getValues, includeBottles)
    const allRows = [...imlRows, [''], ...beerRows, [''], ...bevRows]
    return XLSX.utils.aoa_to_sheet(allRows)
  }

  // ── Opening Stock ─────────────────────────────────────────────────────────
  const openingSheet = fullSheet('OPENING STOCK', (productId, sizeMl) => getEntry(productId, sizeMl, 'OPENING'))

  // ── Receipts ──────────────────────────────────────────────────────────────
  const receiptSheet = fullSheet('RECIEPTS INVOICE', (productId, sizeMl) => {
    return receiptMap.get(`${productId}-${sizeMl}`) ?? null
  }, false)

  // ── Total Stock ───────────────────────────────────────────────────────────
  const totalSheet = fullSheet('TOTAL STOCK', (productId, sizeMl) => {
    const opening = getEntry(productId, sizeMl, 'OPENING')
    const receipt = receiptMap.get(`${productId}-${sizeMl}`)
    return {
      cases: (opening?.cases ?? 0) + (receipt?.cases ?? 0),
      bottles: (opening?.bottles ?? 0) + (receipt?.bottles ?? 0),
    }
  })

  // ── Closing Stock ─────────────────────────────────────────────────────────
  const closingSheet = fullSheet('CLOSING STOCK', (productId, sizeMl) => getEntry(productId, sizeMl, 'CLOSING'))

  // ── Sales & Rate (special format) ─────────────────────────────────────────
  const salesHeaders1 = ['Mahavishnu ', '', 'SALES', '', '', '', '', '', '', '', '', '', 'AMOUNT', 'RATES']
  for (let i = 14; i < 18; i++) salesHeaders1.push('')

  const salesHeaders2 = ['', '']
  for (const size of IML_SIZES) salesHeaders2.push(IML_LABELS[size], '')
  salesHeaders2.push('', '750 ML', '375 ML', '180 ML', '90 ML', '60 ML')

  const salesHeaders3 = ['SL.', 'PRODUCT NAME']
  for (const size of IML_SIZES) salesHeaders3.push(IML_CASE_LABELS[size], 'BTLS')
  salesHeaders3.push('', 'RATE', 'RATE', 'RATE', 'RATE', 'RATE')

  const salesRows: (string | number)[][] = [salesHeaders1, salesHeaders2, salesHeaders3]

  let totalSalesAmount = 0
  let sl = 1
  for (const product of imlProducts) {
    const row: (string | number)[] = [sl++, product.name]

    // Sales per size (computed as Total - Closing, matching manual method)
    for (const sizeMl of IML_SIZES) {
      const opening = getEntry(product.id, sizeMl, 'OPENING')
      const receipt = receiptMap.get(`${product.id}-${sizeMl}`)
      const closing = getEntry(product.id, sizeMl, 'CLOSING')
      const totalCases = (opening?.cases ?? 0) + (receipt?.cases ?? 0)
      const totalBottles = (opening?.bottles ?? 0) + (receipt?.bottles ?? 0)
      const salesCases = totalCases - (closing?.cases ?? 0)
      const salesBottles = totalBottles - (closing?.bottles ?? 0)
      row.push(salesCases, salesBottles)
    }

    // Total amount from recorded sales
    const productSalesAmount = IML_SIZES.reduce((s, sz) =>
      s + (salesMap.get(`${product.id}-${sz}`)?.amount ?? 0), 0)
    totalSalesAmount += productSalesAmount
    row.push(Math.round(productSalesAmount))

    // Selling prices
    for (const sizeMl of IML_SIZES) {
      const ps = product.sizes.find(s => s.sizeMl === sizeMl)
      row.push(ps ? Number(ps.sellingPrice) : '')
    }
    salesRows.push(row)
  }
  salesRows.push(['', 'TOTAL', ...Array(IML_SIZES.length * 2).fill(''), Math.round(totalSalesAmount)])

  const salesSheet = XLSX.utils.aoa_to_sheet(salesRows)

  // ── Expenditure ───────────────────────────────────────────────────────────
  const expenses = await prisma.expenditure.findMany({
    where: { expDate: { gte: session.periodStart, lte: session.periodEnd } },
    orderBy: { expDate: 'asc' },
  })
  const expRows: (string | number | Date)[][] = [
    ['DATE', 'PARTICULARS', 'AMOUNT'],
    ...expenses.map(e => [e.expDate, e.particulars, Number(e.amount)]),
    ['', 'TOTAL', expenses.reduce((s, e) => s + Number(e.amount), 0)],
  ]
  const expSheet = XLSX.utils.aoa_to_sheet(expRows)

  // ── Build Workbook ─────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, openingSheet, 'OPENING STOCK')
  XLSX.utils.book_append_sheet(wb, receiptSheet, 'RECIEPTS')
  XLSX.utils.book_append_sheet(wb, totalSheet, 'TOTAL STOCK')
  XLSX.utils.book_append_sheet(wb, closingSheet, 'CLOSING STOCK')
  XLSX.utils.book_append_sheet(wb, salesSheet, 'SALES & RATE')
  XLSX.utils.book_append_sheet(wb, expSheet, 'EXPENDITURE')

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}
