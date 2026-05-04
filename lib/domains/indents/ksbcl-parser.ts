import pdfParse from "pdf-parse"

export type ParsedIndentItem = {
  srNo: number
  ksbclItemCode: string   // full combined code: "00200103201" or "1022"
  ksbclBaseCode: string   // 8-digit "00200103" or 4-digit "1022"
  ksbclSubCode: string    // 3-digit "201", or "" for old-format codes
  itemName: string        // cleaned display name
  rawItemName: string     // raw text from PDF before cleaning
  sizeMl: number
  bottlesPerCase: number
  ratePerCase: number
  indentCases: number
  indentBottles: number
  indentAmount: number
  cnfCases: number
  cnfBottles: number
  cnfAmount: number
  isRationed: boolean     // CNF < Indent but CNF > 0
  isNotAllocated: boolean // CNF == 0
}

export type ParsedIndent = {
  indentNumber: string
  invoiceNumber: string
  retailerId: string
  retailerName: string
  indentDate: string
  totalRationedItems: number
  totalIndentValue: number
  totalConfirmedValue: number
  items: ParsedIndentItem[]
  rawText: string
  warnings: string[]
}

// 8-digit KSBCL product code — always starts with 0
const CODE_8_RE = /0\d{7}/
// Old-format 4-digit codes used by some legacy KSBCL items (10xx, 11xx range)
const CODE_4_RE = /\b(1[0-9]\d{2})\b/
// Size with explicit bottle count: "750MLx12Btls", "180MLx48P.Btls", "330MLx24Btls"
const SIZE_PACK_RE = /(\d{2,3})\s*ML\s*[xX×]\s*(\d+)\s*P?\.?\s*Btls?/i
// Size only, no bottle count: "650ML(0205)"
const SIZE_ONLY_RE = /(\d{2,3})\s*ML/i

function parseNum(s: string): number {
  return parseFloat(s.replace(/,/g, "")) || 0
}

function normalizeDate(raw: string): string {
  // "4/7/2026" → "2026-04-07"
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw)
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`
  // "07/04/2026" same pattern handled above; already ISO stays as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim()
  return raw.trim()
}

function extractSizeInfo(text: string): { sizeMl: number; bottlesPerCase: number } {
  const packMatch = SIZE_PACK_RE.exec(text)
  if (packMatch) {
    return { sizeMl: parseInt(packMatch[1]), bottlesPerCase: parseInt(packMatch[2]) }
  }
  const sizeMatch = SIZE_ONLY_RE.exec(text)
  if (sizeMatch) {
    const sizeMl = parseInt(sizeMatch[1])
    // KSBCL standard case sizes by bottle volume
    const defaults: Record<number, number> = {
      60: 48, 90: 48, 180: 48, 200: 48,
      275: 24, 330: 24, 375: 24,
      500: 24, 650: 12, 750: 12,
    }
    return { sizeMl, bottlesPerCase: defaults[sizeMl] ?? 12 }
  }
  return { sizeMl: 0, bottlesPerCase: 12 }
}

function cleanItemName(raw: string): string {
  return raw
    .replace(CODE_8_RE, "")                              // remove 8-digit codes
    .replace(CODE_4_RE, "")                              // remove 4-digit codes
    .replace(/\(\d{4}\)/g, "")                          // remove category codes like (0020)
    .replace(SIZE_PACK_RE, "")                           // remove "750MLx12Btls"
    .replace(SIZE_ONLY_RE, "")                           // remove "650ML"
    .replace(/AB\.?\s*Pack/gi, "")                       // remove AB.Pack notation
    .replace(/\b\d{3}\b(?!\s*[-–])/g, "")              // remove standalone 3-digit sub-codes
    .replace(/\s+/g, " ")
    .replace(/[-–,\s]+$/, "")
    .trim()
}

// Detect if a trimmed line (or line tail) is the 7-number data row:
// rate  indentCbs  indentBtls  indentAmount  cnfCbs  cnfBtls  cnfAmount
// Accepts whole numbers (1650) and decimals (1650.00), with or without commas.
const NUM = /\d[\d,]*(?:\.\d+)?/
const DATA_7_RE = new RegExp(
  `(${NUM.source})\\s+(${NUM.source})\\s+(${NUM.source})\\s+(${NUM.source})\\s+(${NUM.source})\\s+(${NUM.source})\\s+(${NUM.source})\\s*$`
)

function matchDataLine(line: string): RegExpExecArray | null {
  const m = DATA_7_RE.exec(line.trim())
  if (!m) return null
  // Rate must be at least 50 ₹/case to avoid matching small reference numbers
  if (parseNum(m[1]) < 50) return null
  return m
}

export async function parseKsbclPdf(buffer: Buffer): Promise<ParsedIndent> {
  const data = await pdfParse(buffer)
  const text = data.text
  const warnings: string[] = []

  // ── Header ──────────────────────────────────────────────────────────────
  // "RETAILER: K-Munirathanam Naidu (07458)  INDENT NO: INDBRP26000290"
  const retailerFull = /RETAILER:\s*(.+?)(?:\s*INDENT\s*NO|\s*$)/i.exec(text)?.[1]?.trim() ?? ""
  const retailerIdMatch = /\((\d{4,6})\)/.exec(retailerFull)
  const retailerId = retailerIdMatch?.[1] ?? ""
  const retailerName = retailerFull.replace(/\(\d+\)/, "").trim()

  const indentNumber = /INDENT\s*NO\s*[:\s]+([A-Z0-9-/]+)/i.exec(text)?.[1]?.trim() ?? ""
  const invoiceNumber = /INVOICE\s*NO\s*[:\s]+([A-Z0-9-/]+)/i.exec(text)?.[1]?.trim() ?? ""
  const dateRaw = /PRINTED\s*ON\s*[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(text)?.[1] ?? ""
  const indentDate = normalizeDate(dateRaw)
  const totalRationedItems = parseInt(/(\d+)\s*Rationed\s*Items/i.exec(text)?.[1] ?? "0")

  if (!indentNumber) warnings.push("Could not parse indent number from PDF")
  if (!retailerId) warnings.push("Could not parse retailer ID from PDF")
  if (!indentDate) warnings.push("Could not parse print date from PDF")

  // ── Table extraction ─────────────────────────────────────────────────────
  // Table starts after "SR NO." column header; ends before "TOTAL \d"
  const tableStartIdx = text.indexOf("SR NO")
  const totalMatch = /\bTOTAL\s+\d/.exec(text)
  const tableText = text.slice(
    tableStartIdx > 0 ? tableStartIdx : 0,
    totalMatch ? totalMatch.index : text.length,
  )

  const lines = tableText.split("\n")

  // Find every line that is the 7-number data tail of a row
  type DataHit = { lineIdx: number; nums: number[]; prefixText: string }
  const dataHits: DataHit[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = matchDataLine(line)
    if (!m) continue
    const nums = m.slice(1).map(parseNum)
    // Text on the data line BEFORE the 7 numbers (single-line rows like items 16-18)
    const prefixText = line.slice(0, m.index ?? 0).trim()
    dataHits.push({ lineIdx: i, nums, prefixText })
  }

  if (dataHits.length === 0) {
    // Include a snippet of the extracted text so format differences are visible
    const snippet = tableText.slice(0, 300).replace(/\n/g, " ↵ ")
    warnings.push(`No table rows parsed — PDF format may not match KSBCL template. First 300 chars of table section: "${snippet}"`)
    return {
      indentNumber, invoiceNumber, retailerId, retailerName, indentDate,
      totalRationedItems, totalIndentValue: 0, totalConfirmedValue: 0,
      items: [], rawText: text, warnings,
    }
  }

  // ── Parse each row ────────────────────────────────────────────────────────
  const items: ParsedIndentItem[] = []
  let prevDataLineIdx = -1

  for (const hit of dataHits) {
    // Row segment: lines from after previous data line up to and including this data line
    const segLines = lines.slice(prevDataLineIdx + 1, hit.lineIdx + 1)
    prevDataLineIdx = hit.lineIdx

    const [rate, iCbs, iBtls, iAmt, cCbs, cBtls, cAmt] = hit.nums

    // Collect description lines: everything except the data line itself.
    // If the data line had prefix text (single-line rows), include that too.
    const descLines: string[] = []
    for (const l of segLines.slice(0, segLines.length - 1)) {
      const t = l.trim()
      if (t) descLines.push(t)
    }
    if (hit.prefixText) descLines.push(hit.prefixText)

    // --- Find SR number ---
    let srNo = 0
    const firstLine = descLines[0] ?? ""
    const soloNum = /^\d{1,2}$/.exec(firstLine)
    if (soloNum) {
      srNo = parseInt(soloNum[0])
      descLines.shift()
    } else {
      // SR number merged with item text: "16 UB Export..."
      const inlineNum = /^(\d{1,2})\s+/.exec(firstLine)
      if (inlineNum) {
        srNo = parseInt(inlineNum[1])
        descLines[0] = firstLine.slice(inlineNum[0].length)
      }
    }
    if (srNo === 0) {
      srNo = items.length + 1
      warnings.push(`Row ${srNo}: SR number not found, using sequential`)
    }

    // --- Join description and extract codes ---
    const descText = descLines.join(" ").trim()

    let baseCode = ""
    let subCode = ""
    let rawItemName = descText

    const m8 = CODE_8_RE.exec(descText)
    if (m8) {
      baseCode = m8[0]
      // Sub-code: look for standalone 3-digit number right after the 8-digit code
      const afterCode = descText.slice(m8.index + 8).trimStart()
      const sub3 = /^(\d{3})\b/.exec(afterCode)
      if (sub3) {
        // Confirm it's not a size (e.g. "330ML")
        const trail = afterCode.slice(sub3[0].length).trimStart()
        if (!/^ML/i.test(trail)) subCode = sub3[1]
      }
      // Also check individual descLines for a standalone 3-digit line
      if (!subCode) {
        for (const dl of descLines) {
          if (/^\d{3}$/.test(dl.trim())) {
            subCode = dl.trim()
            break
          }
        }
      }
      rawItemName = descText.slice(0, m8.index).trim()
    } else {
      const m4 = CODE_4_RE.exec(descText)
      if (m4) {
        baseCode = m4[1]
        rawItemName = descText.slice(0, m4.index).trim()
      } else {
        warnings.push(`Item SR${srNo}: no KSBCL item code found in "${descText.slice(0, 40)}"`)
      }
    }

    const ksbclItemCode = subCode ? `${baseCode}${subCode}` : baseCode
    const itemName = cleanItemName(rawItemName || descText)
    const { sizeMl, bottlesPerCase } = extractSizeInfo(descText)

    const isNotAllocated = cCbs === 0 && cBtls === 0
    const isRationed = !isNotAllocated && (cCbs < iCbs || cBtls < iBtls)

    items.push({
      srNo,
      ksbclItemCode,
      ksbclBaseCode: baseCode,
      ksbclSubCode: subCode,
      itemName,
      rawItemName,
      sizeMl,
      bottlesPerCase,
      ratePerCase: rate,
      indentCases: iCbs,
      indentBottles: iBtls,
      indentAmount: iAmt,
      cnfCases: cCbs,
      cnfBottles: cBtls,
      cnfAmount: cAmt,
      isRationed,
      isNotAllocated,
    })
  }

  // ── Validation ────────────────────────────────────────────────────────────
  const computedRationed = items.filter((i) => i.isRationed).length
  if (totalRationedItems > 0 && computedRationed !== totalRationedItems) {
    warnings.push(
      `Rationed count: PDF summary says ${totalRationedItems}, computed ${computedRationed} — please verify`,
    )
  }

  const totalIndentValue = items.reduce((s, i) => s + i.indentAmount, 0)
  const totalConfirmedValue = items.reduce((s, i) => s + i.cnfAmount, 0)

  return {
    indentNumber,
    invoiceNumber,
    retailerId,
    retailerName,
    indentDate,
    totalRationedItems,
    totalIndentValue,
    totalConfirmedValue,
    items,
    rawText: text,
    warnings,
  }
}
