import pdfParse from "pdf-parse"

export type ParsedIndentItem = {
  srNo: number
  ksbclItemCode: string
  ksbclBaseCode: string
  ksbclSubCode: string
  itemName: string
  rawItemName: string
  sizeMl: number
  bottlesPerCase: number
  ratePerCase: number
  indentCases: number
  indentBottles: number
  indentAmount: number
  cnfCases: number
  cnfBottles: number
  cnfAmount: number
  isRationed: boolean
  isNotAllocated: boolean
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

const CODE_8_RE = /0\d{7}/
const CODE_4_RE = /\b(1[0-9]\d{2})\b/
const SIZE_PACK_RE = /(\d{2,3})\s*ML\s*[xX×]\s*(\d+)\s*P?\.?\s*(?:Btls?|Cans?|ABP)/i
const SIZE_ONLY_RE = /(\d{2,3})\s*ML/i

function parseNum(s: string): number {
  return parseFloat(s.replace(/,/g, "")) || 0
}

function normalizeDate(raw: string): string {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw)
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim()
  return raw.trim()
}

function extractSizeInfo(text: string): { sizeMl: number; bottlesPerCase: number } {
  const packMatch = SIZE_PACK_RE.exec(text)
  if (packMatch) return { sizeMl: parseInt(packMatch[1]), bottlesPerCase: parseInt(packMatch[2]) }
  const sizeMatch = SIZE_ONLY_RE.exec(text)
  if (sizeMatch) {
    const sizeMl = parseInt(sizeMatch[1])
    const defaults: Record<number, number> = { 60: 150, 90: 96, 180: 48, 200: 48, 275: 24, 330: 24, 375: 24, 500: 24, 650: 12, 750: 12 }
    return { sizeMl, bottlesPerCase: defaults[sizeMl] ?? 12 }
  }
  return { sizeMl: 0, bottlesPerCase: 12 }
}

function cleanItemName(raw: string): string {
  return raw
    .replace(CODE_8_RE, "")
    .replace(CODE_4_RE, "")
    .replace(/\(\d{4}\)/g, "")
    .replace(SIZE_PACK_RE, "")
    .replace(SIZE_ONLY_RE, "")
    .replace(/AB\.?\s*Pack/gi, "")
    .replace(/\b\d{3}\b(?!\s*[-–])/g, "")
    .replace(/\s+/g, " ")
    .replace(/[-–,\s]+$/, "")
    .trim()
}

// ── Merged-number parser ──────────────────────────────────────────────────────
//
// KSBCL PDFs render each table row's numeric columns without spaces, e.g.:
//   "4143.49208286.98208286.98"
// = rate(4143.49) + indCBS(2) + indBTLS(0) + indAmt(8286.98) + cnfCBS(2) + cnfBTLS(0) + cnfAmt(8286.98)
//
// Strategy:
//  1. Extract rate (first number, always 0 or 2 decimal places, >= 50)
//  2. For each indent/cnf group: try CBS lengths 1-3, BTLS lengths 1-3.
//     When CBS > 0 use the fact that indAmt = CBS × rate to validate/locate amount.
//     When CBS = 0 (bottle-only), extract the first decimal number as the amount.

type NumGroup = { cbs: number; btls: number; amt: number; rest: string }

function tryGroup(s: string, rate: number): NumGroup | null {
  for (let cl = 1; cl <= 3; cl++) {
    const cbsStr = s.slice(0, cl)
    if (!/^\d+$/.test(cbsStr)) break
    const cbs = parseInt(cbsStr)
    const afterCbs = s.slice(cl)

    for (let bl = 1; bl <= 3; bl++) {
      const btlsStr = afterCbs.slice(0, bl)
      if (!/^\d+$/.test(btlsStr)) break
      const btls = parseInt(btlsStr)
      const afterBtls = afterCbs.slice(bl)

      if (cbs > 0) {
        const expectedAmt = Math.round(cbs * rate * 100) / 100
        // Try both JS default string and toFixed(2)
        for (const amtStr of [String(expectedAmt), expectedAmt.toFixed(2)]) {
          if (afterBtls.startsWith(amtStr)) {
            return { cbs, btls, amt: expectedAmt, rest: afterBtls.slice(amtStr.length) }
          }
        }
      } else {
        // CBS=0: bottle-only row — take the first decimal (up to 2 decimal places)
        const m = /^(\d+\.\d{1,2})(.*)$/.exec(afterBtls)
        if (m) {
          return { cbs: 0, btls, amt: parseNum(m[1]), rest: m[2] }
        }
      }
    }
  }
  return null
}

function tryParseMergedLine(line: string): [number, number, number, number, number, number, number] | null {
  const s = line.trim()
  if (!s || !/^\d/.test(s)) return null

  // Collect rate candidates: decimal (2dp) first, then whole-number prefixes 3-6 digits
  type RC = { rate: number; rest: string }
  const candidates: RC[] = []

  const dm = /^(\d{2,6}\.\d{2})(.*)$/.exec(s)
  if (dm) candidates.push({ rate: parseNum(dm[1]), rest: dm[2] })

  for (let len = 6; len >= 3; len--) {
    const rStr = s.slice(0, len)
    if (!/^\d+$/.test(rStr)) continue
    const r = parseInt(rStr)
    if (r < 50) continue
    // Skip if this duplicates the decimal match
    if (dm && s.slice(0, len) === dm[1].replace(".", "").slice(0, len)) continue
    candidates.push({ rate: r, rest: s.slice(len) })
  }

  for (const { rate, rest } of candidates) {
    const g1 = tryGroup(rest, rate)
    if (!g1) continue
    const g2 = tryGroup(g1.rest, rate)
    if (!g2) continue
    if (g2.rest.trim()) continue // unexpected trailing content
    return [rate, g1.cbs, g1.btls, g1.amt, g2.cbs, g2.btls, g2.amt]
  }

  return null
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function parseKsbclPdf(buffer: Buffer): Promise<ParsedIndent> {
  const data = await pdfParse(buffer)
  const text = data.text
  const warnings: string[] = []

  // Header
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

  // Table section
  const tableStartIdx = text.indexOf("SR NO")
  const totalMatch = /\bTOTAL\s+\d/.exec(text)
  const tableText = text.slice(
    tableStartIdx > 0 ? tableStartIdx : 0,
    totalMatch ? totalMatch.index : text.length,
  )
  const lines = tableText.split("\n")

  // Find data lines
  type DataHit = {
    lineIdx: number
    rate: number; indCbs: number; indBtls: number; indAmt: number
    cnfCbs: number; cnfBtls: number; cnfAmt: number
    prefixText: string
  }
  const dataHits: DataHit[] = []

  for (let i = 0; i < lines.length; i++) {
    const parsed = tryParseMergedLine(lines[i])
    if (!parsed) continue
    const [rate, indCbs, indBtls, indAmt, cnfCbs, cnfBtls, cnfAmt] = parsed
    // The line may have text before the numbers (single-line rows)
    const numStart = lines[i].search(/\d/)
    const prefixText = numStart > 0 ? lines[i].slice(0, numStart).trim() : ""
    dataHits.push({ lineIdx: i, rate, indCbs, indBtls, indAmt, cnfCbs, cnfBtls, cnfAmt, prefixText })
  }

  if (dataHits.length === 0) {
    const snippet = tableText.slice(0, 400).replace(/\n/g, " ↵ ")
    warnings.push(`No table rows parsed. First 400 chars: "${snippet}"`)
    return { indentNumber, invoiceNumber, retailerId, retailerName, indentDate, totalRationedItems, totalIndentValue: 0, totalConfirmedValue: 0, items: [], rawText: text, warnings }
  }

  // Parse each row
  const items: ParsedIndentItem[] = []
  let prevDataLineIdx = -1

  for (const hit of dataHits) {
    const segLines = lines.slice(prevDataLineIdx + 1, hit.lineIdx + 1)
    prevDataLineIdx = hit.lineIdx

    const { rate, indCbs, indBtls, indAmt, cnfCbs, cnfBtls, cnfAmt } = hit

    const descLines: string[] = []
    for (const l of segLines.slice(0, segLines.length - 1)) {
      const t = l.trim()
      if (t) descLines.push(t)
    }
    if (hit.prefixText) descLines.push(hit.prefixText)

    // SR number
    let srNo = 0
    const firstLine = descLines[0] ?? ""
    const soloNum = /^\d{1,2}$/.exec(firstLine)
    if (soloNum) {
      srNo = parseInt(soloNum[0])
      descLines.shift()
    } else {
      const inlineNum = /^(\d{1,2})\s+/.exec(firstLine)
      if (inlineNum) {
        srNo = parseInt(inlineNum[1])
        descLines[0] = firstLine.slice(inlineNum[0].length)
      }
    }
    if (srNo === 0) srNo = items.length + 1

    const descText = descLines.join(" ").trim()

    let baseCode = ""
    let subCode = ""
    let rawItemName = descText

    const m8 = CODE_8_RE.exec(descText)
    if (m8) {
      baseCode = m8[0]
      const afterCode = descText.slice(m8.index + 8).trimStart()
      const sub3 = /^(\d{3})\b/.exec(afterCode)
      if (sub3) {
        const trail = afterCode.slice(sub3[0].length).trimStart()
        if (!/^ML/i.test(trail)) subCode = sub3[1]
      }
      if (!subCode) {
        for (const dl of descLines) {
          if (/^\d{3}$/.test(dl.trim())) { subCode = dl.trim(); break }
        }
      }
      rawItemName = descText.slice(0, m8.index).trim()
    } else {
      const m4 = CODE_4_RE.exec(descText)
      if (m4) {
        baseCode = m4[1]
        rawItemName = descText.slice(0, m4.index).trim()
      } else {
        warnings.push(`SR${srNo}: no KSBCL code in "${descText.slice(0, 40)}"`)
      }
    }

    const ksbclItemCode = subCode ? `${baseCode}${subCode}` : baseCode
    const itemName = cleanItemName(rawItemName || descText)
    const { sizeMl, bottlesPerCase } = extractSizeInfo(descText)

    const isNotAllocated = cnfCbs === 0 && cnfBtls === 0
    const isRationed = !isNotAllocated && (cnfCbs < indCbs || cnfBtls < indBtls)

    items.push({
      srNo, ksbclItemCode, ksbclBaseCode: baseCode, ksbclSubCode: subCode,
      itemName, rawItemName, sizeMl, bottlesPerCase,
      ratePerCase: rate,
      indentCases: indCbs, indentBottles: indBtls, indentAmount: indAmt,
      cnfCases: cnfCbs, cnfBottles: cnfBtls, cnfAmount: cnfAmt,
      isRationed, isNotAllocated,
    })
  }

  const computedRationed = items.filter((i) => i.isRationed).length
  if (totalRationedItems > 0 && computedRationed !== totalRationedItems) {
    warnings.push(`Rationed count: PDF says ${totalRationedItems}, computed ${computedRationed}`)
  }

  const totalIndentValue = items.reduce((s, i) => s + i.indentAmount, 0)
  const totalConfirmedValue = items.reduce((s, i) => s + i.cnfAmount, 0)

  return { indentNumber, invoiceNumber, retailerId, retailerName, indentDate, totalRationedItems, totalIndentValue, totalConfirmedValue, items, rawText: text, warnings }
}
