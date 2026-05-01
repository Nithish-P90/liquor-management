import { Category, Prisma } from "@prisma/client"
import * as XLSX from "xlsx"

import { inferCategory } from "@/lib/infer-category"

export type ProductImportRow = {
  itemCode: string
  name: string
  category: Category
  sizeMl: number
  bottlesPerCase: number
  mrp: number
  sellingPrice: number
  barcode?: string
}

const STOCK_SHEET_SIZE_MAP = [
  { sizeMl: 750, bottlesPerCase: 12, col: 13 },
  { sizeMl: 375, bottlesPerCase: 24, col: 14 },
  { sizeMl: 180, bottlesPerCase: 48, col: 15 },
  { sizeMl: 90, bottlesPerCase: 96, col: 16 },
  { sizeMl: 60, bottlesPerCase: 25, col: 17 },
] as const

function sanitizeText(v: unknown): string {
  return String(v ?? "").trim()
}

function normalizeCategory(value: string): Category {
  const upper = value.toUpperCase().replace(/\s+/g, "_")
  const categories: Category[] = [
    "BRANDY",
    "WHISKY",
    "RUM",
    "VODKA",
    "GIN",
    "WINE",
    "PREMIX",
    "BEER",
    "BEVERAGE",
    "MISCELLANEOUS",
  ]

  if (categories.includes(upper as Category)) {
    return upper as Category
  }

  return inferCategory(value)
}

function cleanProductName(value: unknown): string {
  return sanitizeText(value)
    .replace(/\s+/g, " ")
    .replace(/^\d+\.?\s*/, "")
    .trim()
}

function isMeaningfulName(name: string): boolean {
  if (!name) return false
  if (/^0+$/.test(name)) return false
  return /[A-Za-z]/.test(name)
}

function toNumber(value: unknown): number {
  if (value == null || value === "") return 0
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

function generatePendingCode(index: number): string {
  return `KSBCL-PENDING-${String(index).padStart(4, "0")}`
}

function parseStructuredRows(rows: Record<string, unknown>[]): ProductImportRow[] {
  const parsed: ProductImportRow[] = []
  let pendingIndex = 1
  const pendingCodeByName = new Map<string, string>()

  for (const row of rows) {
    const name = cleanProductName(row.name)
    if (!isMeaningfulName(name)) continue

    const itemCodeRaw = sanitizeText(row.itemCode)
    const itemCode = itemCodeRaw
      ? itemCodeRaw
      : (() => {
          const key = name.toLowerCase()
          const existing = pendingCodeByName.get(key)
          if (existing) return existing
          const next = generatePendingCode(pendingIndex++)
          pendingCodeByName.set(key, next)
          return next
        })()

    const sizeMl = toNumber(row.sizeMl)
    const bottlesPerCase = toNumber(row.bottlesPerCase)
    const mrp = toNumber(row.mrp)
    const sellingPrice = toNumber(row.sellingPrice)

    if (sizeMl <= 0 || bottlesPerCase <= 0) continue

    parsed.push({
      itemCode,
      name,
      category: normalizeCategory(sanitizeText(row.category) || name),
      sizeMl,
      bottlesPerCase,
      mrp,
      sellingPrice: sellingPrice > 0 ? sellingPrice : mrp,
      barcode: sanitizeText(row.barcode) || undefined,
    })
  }

  return parsed
}

function parseSalesRateSheet(rows: unknown[][]): ProductImportRow[] {
  const parsed: ProductImportRow[] = []
  let pendingIndex = 1
  const codeByName = new Map<string, string>()

  for (let i = 3; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const name = cleanProductName(row[1])

    if (!isMeaningfulName(name)) continue

    const key = name.toLowerCase()
    const itemCode = codeByName.get(key) ?? generatePendingCode(pendingIndex++)
    if (!codeByName.has(key)) {
      codeByName.set(key, itemCode)
    }

    for (const size of STOCK_SHEET_SIZE_MAP) {
      const rate = toNumber(row[size.col])
      if (rate <= 0) continue

      parsed.push({
        itemCode,
        name,
        category: inferCategory(name),
        sizeMl: size.sizeMl,
        bottlesPerCase: size.bottlesPerCase,
        mrp: rate,
        sellingPrice: rate,
      })
    }
  }

  return parsed
}

export function parseProductRowsFromWorkbook(buffer: Buffer): ProductImportRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" })

  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  const structuredRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
    defval: null,
    raw: false,
  })

  const structuredParsed = parseStructuredRows(structuredRows)
  if (structuredParsed.length > 0) {
    return structuredParsed
  }

  const salesRateSheetName = workbook.SheetNames.find((name) => /sales\s*&\s*rate/i.test(name))
  if (!salesRateSheetName) {
    const fallbackRows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
      header: 1,
      defval: null,
      raw: false,
    })

    return parseSalesRateSheet(fallbackRows)
  }

  const salesRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[salesRateSheetName], {
    header: 1,
    defval: null,
    raw: false,
  })

  return parseSalesRateSheet(salesRows)
}

export async function upsertProductRows(
  tx: Prisma.TransactionClient,
  rows: ProductImportRow[],
): Promise<{ created: number; updated: number; errors: Array<{ row: number; error: string }> }> {
  let created = 0
  let updated = 0
  const errors: Array<{ row: number; error: string }> = []

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]

    try {
      const product = await tx.product.upsert({
        where: { itemCode: row.itemCode },
        update: {
          name: row.name,
          category: row.category,
        },
        create: {
          itemCode: row.itemCode,
          name: row.name,
          category: row.category,
        },
        select: { id: true },
      })

      const existingSize = await tx.productSize.findUnique({
        where: {
          productId_sizeMl: {
            productId: product.id,
            sizeMl: row.sizeMl,
          },
        },
        select: { id: true },
      })

      await tx.productSize.upsert({
        where: {
          productId_sizeMl: {
            productId: product.id,
            sizeMl: row.sizeMl,
          },
        },
        update: {
          bottlesPerCase: row.bottlesPerCase,
          mrp: new Prisma.Decimal(row.mrp.toFixed(2)),
          sellingPrice: new Prisma.Decimal(row.sellingPrice.toFixed(2)),
          barcode: row.barcode,
        },
        create: {
          productId: product.id,
          sizeMl: row.sizeMl,
          bottlesPerCase: row.bottlesPerCase,
          mrp: new Prisma.Decimal(row.mrp.toFixed(2)),
          sellingPrice: new Prisma.Decimal(row.sellingPrice.toFixed(2)),
          barcode: row.barcode,
        },
      })

      if (existingSize) {
        updated += 1
      } else {
        created += 1
      }
    } catch (error) {
      errors.push({
        row: i + 1,
        error: error instanceof Error ? error.message : "Unknown import error",
      })
    }
  }

  return { created, updated, errors }
}
