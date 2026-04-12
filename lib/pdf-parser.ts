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
  sizeMl: number
  bottlesPerCase: number
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

function detectSize(itemName: string): { sizeMl: number; bottlesPerCase: number } {
  const patterns: { regex: RegExp; sizeMl: number; bottlesPerCase: number }[] = [
    { regex: /650\s*ml.*?(\d+)\s*btl/i, sizeMl: 650, bottlesPerCase: 12 },
    { regex: /750\s*ml.*?(\d+)\s*btl/i, sizeMl: 750, bottlesPerCase: 12 },
    { regex: /500\s*ml.*?(\d+)\s*btl/i, sizeMl: 500, bottlesPerCase: 24 },
    { regex: /375\s*ml.*?(\d+)\s*btl/i, sizeMl: 375, bottlesPerCase: 24 },
    { regex: /330\s*ml.*?(\d+)\s*btl/i, sizeMl: 330, bottlesPerCase: 24 },
    { regex: /275\s*ml.*?(\d+)\s*btl/i, sizeMl: 275, bottlesPerCase: 24 },
    { regex: /180\s*ml.*?(\d+)\s*(?:btl|p\.btl)/i, sizeMl: 180, bottlesPerCase: 48 },
    { regex: /90\s*ml.*?(\d+)\s*btl/i, sizeMl: 90, bottlesPerCase: 96 },
    { regex: /60\s*ml.*?(\d+)\s*btl/i, sizeMl: 60, bottlesPerCase: 25 },
    { regex: /650\s*ml/i, sizeMl: 650, bottlesPerCase: 12 },
    { regex: /750\s*ml/i, sizeMl: 750, bottlesPerCase: 12 },
    { regex: /500\s*ml/i, sizeMl: 500, bottlesPerCase: 24 },
    { regex: /375\s*ml/i, sizeMl: 375, bottlesPerCase: 24 },
    { regex: /330\s*ml/i, sizeMl: 330, bottlesPerCase: 24 },
    { regex: /275\s*ml/i, sizeMl: 275, bottlesPerCase: 24 },
    { regex: /180\s*ml/i, sizeMl: 180, bottlesPerCase: 48 },
    { regex: /90\s*ml/i, sizeMl: 90, bottlesPerCase: 96 },
    { regex: /60\s*ml/i, sizeMl: 60, bottlesPerCase: 25 },
  ]
  for (const p of patterns) {
    if (p.regex.test(itemName)) {
      const bpcMatch = itemName.match(/x\s*(\d+)\s*(?:btl|p\.btl)/i)
      const bpc = bpcMatch ? parseInt(bpcMatch[1]) : p.bottlesPerCase
      return { sizeMl: p.sizeMl, bottlesPerCase: bpc }
    }
  }
  return { sizeMl: 750, bottlesPerCase: 12 }
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
  const compactLine = dataLine.replace(/,/g, '')
  const rateMatch = compactLine.match(/^(\d+\.\d{2})(.*)$/)
  if (!rateMatch) {
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

  const ratePerCase = parseFloat(rateMatch[1])
  let rest = rateMatch[2]

  const indentSegment = takeAmountSegment(rest)
  rest = indentSegment.rest
  const cnfSegment = takeAmountSegment(rest)

  const indent = parseQuantityAmountSegment(indentSegment.segment, ratePerCase, bottlesPerCase)
  const cnf = parseQuantityAmountSegment(cnfSegment.segment, ratePerCase, bottlesPerCase)

  return {
    ratePerCase,
    indentCases: indent.cases,
    indentBottles: indent.bottles,
    indentAmount: indent.amount,
    cnfCases: cnf.cases,
    cnfBottles: cnf.bottles,
    cnfAmount: cnf.amount,
  }
}

function takeAmountSegment(value: string): { segment: string; rest: string } {
  const dot = value.indexOf('.')
  if (dot < 0) return { segment: value, rest: '' }
  const end = Math.min(value.length, dot + 3)
  return { segment: value.slice(0, end), rest: value.slice(end) }
}

function parseQuantityAmountSegment(segment: string, ratePerCase: number, bottlesPerCase: number) {
  if (!segment || !/\d/.test(segment)) {
    return { cases: 0, bottles: 0, amount: 0 }
  }

  const decimalMatch = segment.match(/^(\d+)\.(\d{2})$/)
  if (!decimalMatch) {
    return { cases: 0, bottles: 0, amount: 0 }
  }

  const beforeDecimal = decimalMatch[1]
  const decimals = decimalMatch[2]
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
    return { cases: best.cases, bottles: best.bottles, amount: best.amount }
  }

  const largestAmount = candidates.sort((a, b) => b.amount - a.amount)[0]?.amount
    ?? parseFloat(segment)
    ?? 0
  if (!ratePerCase || !Number.isFinite(largestAmount)) {
    return { cases: 0, bottles: 0, amount: Number.isFinite(largestAmount) ? largestAmount : 0 }
  }

  const exactCases = largestAmount / ratePerCase
  const cases = Math.floor(exactCases)
  const bottles = Math.round((exactCases - cases) * bottlesPerCase)
  return { cases, bottles: bottles >= bottlesPerCase ? 0 : bottles, amount: largestAmount }
}

export async function parseIndentPdf(buffer: Buffer): Promise<ParsedIndent> {
  const data = await pdfParse(buffer)
  const text = data.text

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

  // Find where data rows start: after the header block (look for first lone digit = SR "1")
  // Rows follow the pattern:
  //   [SR number line]
  //   [item name line(s)]
  //   [item code line]
  //   [prefix/rate line]
  //   [data numbers line]
  //   [next SR...]

  const items: IndentLineItem[] = []

  // Collect all non-empty lines after the column headers
  // Column header block: "SR NO.ITEM NAMEITEM CODE", "RATE", "(PER CB.)", "INDENT", "CBS", ...
  // Find the first line that is just a number "1" = first row SR
  let i = 0
  // Skip header section
  while (i < lines.length && !/^1$/.test(lines[i])) i++

  while (i < lines.length) {
    const line = lines[i]

    // Check if this is a SR number line (1-18)
    if (!/^\d{1,2}$/.test(line)) { i++; continue }
    const srNo = parseInt(line)
    if (srNo < 1 || srNo > 100) { i++; continue }

    i++
    // Collect item name lines (until we hit an item code line = 4-8 digits only, or a number-heavy line)
    const nameLines: string[] = []
    while (
      i < lines.length
      && !/^\d{4,8}$/.test(lines[i])
      && !/^\d{3,4}$/.test(lines[i])
      && !/^\d{4}\d+\.\d{2}/.test(lines[i])
      && lines[i] !== ''
    ) {
      // Item code can be 4 digits too (1022, 1024, 1040)
      // Stop if we see a pure number that looks like a code or rate prefix
      if (/^\d+(\.\d+)?$/.test(lines[i]) && nameLines.length > 0) break
      nameLines.push(lines[i])
      i++
    }
    const itemName = nameLines.join(' ').trim()

    // Now expect item code (4-8 digit number)
    let itemCode = ''
    if (i < lines.length && /^\d{4,8}$/.test(lines[i])) {
      itemCode = lines[i]
      i++
    }

    // Now expect either an item-code suffix followed by data, or data directly.
    let dataLine = ''

    if (i < lines.length) {
      const nextLine = lines[i]
      // If it contains a decimal → it's the data line (no separate prefix)
      if (/\d+\.\d{2}/.test(nextLine)) {
        const embeddedCodeMatch = nextLine.match(/^(\d{4})(\d+\.\d{2}.*)$/)
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
    const parsed = parseNumberBlock(dataLine, bottlesPerCase)
    const ratePerCase = parsed.ratePerCase

    items.push({
      srNo,
      itemName,
      itemCode,
      ratePerCase,
      indentCases: parsed.indentCases,
      indentBottles: parsed.indentBottles,
      indentAmount: parsed.indentAmount,
      cnfCases: parsed.cnfCases,
      cnfBottles: parsed.cnfBottles,
      cnfAmount: parsed.cnfAmount,
      isRationed: false,
      sizeMl,
      bottlesPerCase,
    })
  }

  // Mark rationed items: those where CNF < Indent significantly
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

  return { header, items, totals }
}
