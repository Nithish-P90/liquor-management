// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse/lib/pdf-parse.js')

export interface IndentHeader {
  indentNumber: string
  invoiceNumber: string
  retailerId: string
  retailerName: string
  indentDate: string
  rationedCount: number
}

export interface IndentLineItem {
  srNo: number
  itemName: string
  itemCode: string
  ratePerCase: number
  indentCases: number
  indentBottles: number
  indentAmount: number
  cnfCases: number
  cnfBottles: number
  cnfAmount: number
  isRationed: boolean
  parseError?: number
  parseConfidence?: boolean
  sizeMl: number
  bottlesPerCase: number
  debugRawLine?: string
}

export interface ParsedIndent {
  header: IndentHeader
  items: IndentLineItem[]
  totals: {
    indentCases: number
    indentBottles: number
    indentAmount: number
    cnfCases: number
    cnfBottles: number
    cnfAmount: number
  }
}

export interface ParsedIndentWithRaw extends ParsedIndent {
  rawText?: string
}

function detectSize(itemName: string): { sizeMl: number; bottlesPerCase: number } {
  // First try to extract explicit bottles-per-case from the name.
  // KSBCL names use patterns like "x24Btl", "x 24 Btl", "x24P.Btl", "24 Btls", etc.
  const bpcMatch = itemName.match(/x\s*(\d+)\s*p?\.?\s*btl/i)
    ?? itemName.match(/(\d+)\s*p?\.?\s*btls?\b/i)
  const explicitBpc = bpcMatch ? parseInt(bpcMatch[1]) : null

  // Default BPC per size — beer sizes (330/500/650ml) default to 24, spirits to 12
  const patterns: { regex: RegExp; sizeMl: number; defaultBpc: number }[] = [
    { regex: /650\s*ml/i, sizeMl: 650, defaultBpc: 24 },
    { regex: /750\s*ml/i, sizeMl: 750, defaultBpc: 12 },
    { regex: /500\s*ml/i, sizeMl: 500, defaultBpc: 24 },
    { regex: /375\s*ml/i, sizeMl: 375, defaultBpc: 24 },
    { regex: /330\s*ml/i, sizeMl: 330, defaultBpc: 24 },
    { regex: /275\s*ml/i, sizeMl: 275, defaultBpc: 24 },
    { regex: /180\s*ml/i, sizeMl: 180, defaultBpc: 48 },
    { regex: /90\s*ml/i,  sizeMl: 90,  defaultBpc: 96 },
    { regex: /60\s*ml/i,  sizeMl: 60,  defaultBpc: 25 },
  ]
  for (const p of patterns) {
    if (p.regex.test(itemName)) {
      // Use explicit value from the name if present, otherwise use the default
      const bpc = (explicitBpc && explicitBpc > 0) ? explicitBpc : p.defaultBpc
      return { sizeMl: p.sizeMl, bottlesPerCase: bpc }
    }
  }
  return { sizeMl: 750, bottlesPerCase: explicitBpc ?? 12 }
}

/**
 * Parse the concatenated number block from KSBCL PDF.
 *
 * The PDF text extractor concatenates all 6 numeric columns into one string:
 *   [IndCBS][IndBTLS][IndAmt][CNFCbs][CNFBtls][CNFAmt]
 *
 * IndCBS and CNFCbs are 1-3 digit integers.
 * IndBTLS and CNFBtls are 1-2 digit integers (0-23 for 24-pack, 0-47 for 48-pack etc).
 * Amounts are decimal numbers like "13631.85"
 *
 * Strategy: find the two decimal amounts first, then split the integer prefix and middle.
 */
function parseNumberBlock(dataLine: string, bottlesPerCase: number): {
  ratePerCase: number
  indentCases: number
  indentBottles: number
  indentAmount: number
  cnfCases: number
  cnfBottles: number
  cnfAmount: number
} {
  // Compact numeric block (remove commas). Keep original spacing fallback if needed.
  const compactLine = dataLine.replace(/,/g, '').replace(/\s+/g, '').trim()

  // First try: rate at the beginning (common in well-formed PDFs)
  let ratePerCase = 0
  let rest = ''
  const startRateMatch = compactLine.match(/^(\d+\.\d{2})(.*)$/)
  if (startRateMatch) {
    ratePerCase = parseFloat(startRateMatch[1])
    rest = startRateMatch[2]
  } else {
    // Fallback: find first decimal occurrence anywhere (handles stray prefixes or symbols)
    const decimals = compactLine.match(/\d+\.\d{2}/g)
    if (decimals && decimals.length > 0) {
      const firstDec = decimals[0]
      ratePerCase = parseFloat(firstDec)
      const idx = compactLine.indexOf(firstDec)
      rest = compactLine.slice(idx + firstDec.length)
    } else {
      // As a last resort, try to find decimals in the original (space-preserved) line
      const spaced = dataLine.replace(/,/g, '').trim()
      const decSpaces = spaced.match(/\d+\.\d{2}/)
      if (decSpaces) {
        const d = decSpaces[0]
        ratePerCase = parseFloat(d)
        const idx = spaced.indexOf(d)
        rest = spaced.slice(idx + d.length).replace(/\s+/g, '')
      } else {
        return {
          ratePerCase: 0,
          indentCases: 0,
          indentBottles: 0,
          indentAmount: 0,
          cnfCases: 0,
          cnfBottles: 0,
          cnfAmount: 0,
        }
      }
    }
  }

  // KSBCL amounts can have 1 or 2 decimal places (e.g. 26727.4 vs 16049.44).
  // Try all combinations of 1/2 decimal digits for indent and CNF and pick lowest error.
  let best = { ratePerCase, indentCases: 0, indentBottles: 0, indentAmount: 0, cnfCases: 0, cnfBottles: 0, cnfAmount: 0 }
  let bestError = Infinity

  for (const indentDec of [1, 2]) {
    const indentSeg = takeAmountSegmentN(rest, indentDec)
    const indent = parseQuantityAmountSegment(indentSeg.segment, ratePerCase, bottlesPerCase)
    for (const cnfDec of [1, 2]) {
      const cnfSeg = takeAmountSegmentN(indentSeg.rest, cnfDec)
      const cnf = parseQuantityAmountSegment(cnfSeg.segment, ratePerCase, bottlesPerCase)
      const totalError = indent.error + cnf.error
      if (totalError < bestError) {
        bestError = totalError
        best = { ratePerCase, indentCases: indent.cases, indentBottles: indent.bottles, indentAmount: indent.amount, cnfCases: cnf.cases, cnfBottles: cnf.bottles, cnfAmount: cnf.amount }
      }
    }
  }
  return best
}

function takeAmountSegmentN(value: string, decimals: number): { segment: string; rest: string } {
  const dot = value.indexOf('.')
  if (dot < 0) return { segment: value, rest: '' }
  const end = Math.min(value.length, dot + 1 + decimals)
  return { segment: value.slice(0, end), rest: value.slice(end) }
}

function parseQuantityAmountSegment(segment: string, ratePerCase: number, bottlesPerCase: number) {
  const cleanSegment = segment.replace(/\s+/g, '')
  if (!cleanSegment || !/\d/.test(cleanSegment)) {
    return { cases: 0, bottles: 0, amount: 0, error: Infinity }
  }

  // Accept 1 or 2 decimal places; normalise to 2 for arithmetic
  const decimalMatch = cleanSegment.match(/^(\d+)\.(\d{1,2})$/)
  if (!decimalMatch) {
    return { cases: 0, bottles: 0, amount: 0, error: Infinity }
  }

  const beforeDecimal = decimalMatch[1]
  const decimals = decimalMatch[2].padEnd(2, '0')
  const candidates: { cases: number; bottles: number; amount: number; error: number }[] = []

  for (let qtyLength = 1; qtyLength < Math.min(beforeDecimal.length, 4); qtyLength++) {
    const qtyPart = beforeDecimal.slice(0, qtyLength)
    const amountPart = beforeDecimal.slice(qtyLength)
    if (!amountPart) continue

    for (let split = 1; split <= qtyPart.length; split++) {
      const cases = parseInt(qtyPart.slice(0, split)) || 0
      const bottles = parseInt(qtyPart.slice(split) || '0') || 0
      if (bottles >= bottlesPerCase) continue

      const amount = parseFloat(`${amountPart}.${decimals}`)
      const expected = (cases * ratePerCase) + ((bottles * ratePerCase) / bottlesPerCase)
      candidates.push({ cases, bottles, amount, error: Math.abs(expected - amount) })
    }
  }

  const best = candidates.sort((a, b) => a.error - b.error)[0]
  if (best && best.error <= Math.max(1, ratePerCase * 0.02)) {
    return { cases: best.cases, bottles: best.bottles, amount: best.amount, error: best.error }
  }

  const largestAmount = candidates.sort((a, b) => b.amount - a.amount)[0]?.amount
    ?? parseFloat(segment)
    ?? 0
  if (!ratePerCase || !Number.isFinite(largestAmount)) {
    return { cases: 0, bottles: 0, amount: Number.isFinite(largestAmount) ? largestAmount : 0, error: Infinity }
  }

  const exactCases = largestAmount / ratePerCase
  const cases = Math.floor(exactCases)
  const bottles = Math.round((exactCases - cases) * bottlesPerCase)
  return { cases, bottles: bottles >= bottlesPerCase ? 0 : bottles, amount: largestAmount, error: Infinity }
}

export async function parseIndentPdf(buffer: Buffer): Promise<ParsedIndentWithRaw> {
  const data = await pdfParse(buffer)
  const text = data.text ?? ''
  return parseIndentFromText(text)
}

export function parseIndentFromText(text: string): ParsedIndentWithRaw {
  // Extract header from the dense header line
  // "RETAILER:K-Munirathanam Naidu (07458)INDENT NO:INDBRP26000290"
  const retailerMatch = text.match(/RETAILER:\s*(.+?)\s*\((\d+)\)\s*INDENT\s*NO:\s*(IND\w+)/i)
  const invoiceMatch = text.match(/INVOICE\s*NO:\s*(S\w+)/i)
  const dateMatch = text.match(/PRINTED\s*ON:\s*([\d/,\s:APMapm]+)/i)
  const rationedMatch = text.match(/(\d+)\s+Rationed\s+Items\s+Detected/i)

  const header: IndentHeader = {
    indentNumber: retailerMatch?.[3] ?? 'UNKNOWN',
    invoiceNumber: invoiceMatch?.[1] ?? '',
    retailerId: retailerMatch?.[2] ?? '',
    retailerName: retailerMatch?.[1]?.trim() ?? 'Mahavishnu',
    indentDate: dateMatch?.[1]?.trim() ?? new Date().toLocaleDateString('en-IN'),
    rationedCount: rationedMatch ? parseInt(rationedMatch[1]) : 0,
  }

  const lines = text.split('\n').map((l: string) => l.trim())

  const items: IndentLineItem[] = []

  let i = 0
  while (i < lines.length && !/^1$/.test(lines[i])) i++

  while (i < lines.length) {
    const line = lines[i]
    if (!/^\d{1,2}$/.test(line)) { i++; continue }
    const srNo = parseInt(line)
    if (srNo < 1 || srNo > 100) { i++; continue }

    i++
    const nameLines: string[] = []
    while (
      i < lines.length
      && !/^\d{4,8}$/.test(lines[i])
      && !/^\d{3,4}$/.test(lines[i])
      && !/^\d{4}\d+\.\d{2}/.test(lines[i])
      && lines[i] !== ''
    ) {
      if (/^\d+(\.\d+)?$/.test(lines[i]) && nameLines.length > 0) break
      nameLines.push(lines[i])
      i++
    }
    const itemName = nameLines.join(' ').trim()

    let itemCode = ''
    if (i < lines.length && /^\d{4,8}$/.test(lines[i])) {
      itemCode = lines[i]
      i++
    }

    let dataLine = ''
    if (i < lines.length) {
      const nextLine = lines[i]
      if (/\d+\.\d{2}/.test(nextLine)) {
        const cleanNext = nextLine.replace(/\s/g, '')
        const embeddedCodeMatch = cleanNext.match(/^(\d{4})(\d+\.\d{2}.*)$/)
        if (!itemCode && embeddedCodeMatch) {
          itemCode = embeddedCodeMatch[1]
          dataLine = embeddedCodeMatch[2]
        } else {
          dataLine = nextLine
        }
        i++
      } else if (/^\d{3,4}$/.test(nextLine)) {
        if (itemCode === '' && nextLine.length === 4) {
          itemCode = nextLine
          i++
          if (i < lines.length && /\d+\.\d{2}/.test(lines[i])) {
            dataLine = lines[i]; i++
          }
        } else {
          itemCode = `${itemCode}${nextLine}`
          i++
          if (i < lines.length) {
            dataLine = lines[i]; i++
          }
        }
      } else {
        i++
      }
    }

    if (!dataLine || !itemCode) continue

    const { sizeMl, bottlesPerCase } = detectSize(itemName)
    const nums = parseNumberBlock(dataLine, bottlesPerCase)
    const ratePerCase = nums.ratePerCase

    const computedCnfAmount = (nums.cnfCases * ratePerCase) + (nums.cnfBottles * ratePerCase / bottlesPerCase)
    const parseError = Math.abs((nums.cnfAmount || 0) - computedCnfAmount)
    const parseConfidence = parseError <= Math.max(1, ratePerCase * 0.02)

    items.push({
      srNo,
      itemName,
      itemCode,
      ratePerCase,
      indentCases: nums.indentCases,
      indentBottles: nums.indentBottles,
      indentAmount: nums.indentAmount,
      cnfCases: nums.cnfCases,
      cnfBottles: nums.cnfBottles,
      cnfAmount: nums.cnfAmount,
      isRationed: false,
      parseError,
      parseConfidence,
      sizeMl,
      bottlesPerCase,
      debugRawLine: dataLine,
    })
  }

  if (header.rationedCount > 0 && items.length > 0) {
    const candidates = items.filter(item => item.cnfAmount > 0 && item.cnfAmount < item.indentAmount)
    const fallbackCandidates = candidates.length >= header.rationedCount
      ? candidates
      : items.filter(item => item.cnfAmount < item.indentAmount)

    const sorted = [...fallbackCandidates].sort((a, b) => {
      const aRatio = a.cnfAmount / Math.max(a.indentAmount, 1)
      const bRatio = b.cnfAmount / Math.max(b.indentAmount, 1)
      return aRatio - bRatio
    })
    for (let j = 0; j < header.rationedCount && j < sorted.length; j++) {
      const item = items.find(x => x.srNo === sorted[j].srNo)
      if (item) item.isRationed = true
    }
  }

  const totals = {
    indentCases: items.reduce((s, x) => s + x.indentCases, 0),
    indentBottles: items.reduce((s, x) => s + x.indentBottles, 0),
    indentAmount: items.reduce((s, x) => s + x.indentAmount, 0),
    cnfCases: items.reduce((s, x) => s + x.cnfCases, 0),
    cnfBottles: items.reduce((s, x) => s + x.cnfBottles, 0),
    cnfAmount: items.reduce((s, x) => s + x.cnfAmount, 0),
  }

  return { header, items, totals, rawText: text }
}
