import pdfParse from "pdf-parse"

export type ParsedIndentItem = {
  ksbclItemCode: string
  itemName: string
  sizeMl: number
  bottlesPerCase: number
  indentCases: number
  indentBottles: number
  indentAmount: number
  cnfCases: number
  cnfBottles: number
  cnfAmount: number
  ratePerCase: number
}

export type ParsedIndent = {
  indentNumber: string
  invoiceNumber: string
  retailerId: string
  retailerName: string
  indentDate: string
  totalConfirmedValue: number
  totalIndentValue: number
  items: ParsedIndentItem[]
  rawText: string
  warnings: string[]
}

const INDENT_NO_RE = /(?:Indent\s*No\.?\s*|INDENT\s*NO\.?\s*)[:\s]*([A-Z0-9/-]+)/i
const INVOICE_NO_RE = /(?:Invoice\s*No\.?\s*|INVOICE\s*NO\.?\s*)[:\s]*([A-Z0-9/-]+)/i
const RETAILER_ID_RE = /(?:Retailer\s*ID|RETAILER\s*ID)[:\s]*([A-Z0-9]+)/i
const RETAILER_NAME_RE = /(?:Retailer\s*Name|RETAILER\s*NAME)[:\s]*([^\n\r]+)/i
const DATE_RE = /(?:Date|DATE)[:\s]*(\d{2}[/-]\d{2}[/-]\d{4}|\d{4}[/-]\d{2}[/-]\d{2})/i
const TOTAL_CNF_RE = /(?:Total\s*Confirmed|TOTAL\s*CNF)[:\s]*(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)/i
const SIZE_PACK_RE = /(\d+)\s*[Mm][Ll]\s*[Xx×]\s*(\d+)/

// Row pattern: code name sizexpack ... cases bottles amount
const ROW_RE =
  /([A-Z0-9]{4,12})\s+(.+?)\s+(\d+)\s*[Mm][Ll]\s*[Xx×]\s*(\d+)\s+([\d,]+)\s+([\d,]+)\s+([\d,.]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,.]+)/g

function parseNum(s: string): number {
  return parseFloat(s.replace(/,/g, "")) || 0
}

function normalizeDate(raw: string): string {
  const clean = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean
  const parts = clean.split(/[/-]/)
  if (parts.length !== 3) return clean
  if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`
  return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`
}

export async function parseKsbclPdf(buffer: Buffer): Promise<ParsedIndent> {
  const data = await pdfParse(buffer)
  const text = data.text
  const warnings: string[] = []

  const indentNumber = INDENT_NO_RE.exec(text)?.[1]?.trim() ?? ""
  const invoiceNumber = INVOICE_NO_RE.exec(text)?.[1]?.trim() ?? ""
  const retailerId = RETAILER_ID_RE.exec(text)?.[1]?.trim() ?? ""
  const retailerName = RETAILER_NAME_RE.exec(text)?.[1]?.trim() ?? ""
  const dateRaw = DATE_RE.exec(text)?.[1] ?? ""
  const indentDate = normalizeDate(dateRaw)
  const totalConfirmedValue = parseNum(TOTAL_CNF_RE.exec(text)?.[1] ?? "0")

  if (!indentNumber) warnings.push("Could not parse indent number")
  if (!retailerId) warnings.push("Could not parse retailer ID")
  if (!indentDate) warnings.push("Could not parse indent date")

  const items: ParsedIndentItem[] = []
  let totalIndentValue = 0
  let sumCnf = 0

  for (const match of Array.from(text.matchAll(ROW_RE))) {
    const [, code, name, sizeStr, packStr, ic, ib, ia, cc, cb, ca] = match
    const item: ParsedIndentItem = {
      ksbclItemCode: code.trim(),
      itemName: name.trim(),
      sizeMl: parseInt(sizeStr, 10),
      bottlesPerCase: parseInt(packStr, 10),
      indentCases: parseNum(ic),
      indentBottles: parseNum(ib),
      indentAmount: parseNum(ia),
      cnfCases: parseNum(cc),
      cnfBottles: parseNum(cb),
      cnfAmount: parseNum(ca),
      ratePerCase: parseNum(ia) / (parseNum(ic) || 1),
    }
    items.push(item)
    totalIndentValue += item.indentAmount
    sumCnf += item.cnfAmount
  }

  if (items.length === 0) {
    warnings.push("No line items parsed — PDF format may not match expected pattern")
  }

  if (totalConfirmedValue > 0 && Math.abs(sumCnf - totalConfirmedValue) > 1) {
    warnings.push(
      `CNF total mismatch: sum of items=${sumCnf.toFixed(2)}, PDF total=${totalConfirmedValue.toFixed(2)}`,
    )
  }

  return {
    indentNumber,
    invoiceNumber,
    retailerId,
    retailerName,
    indentDate,
    totalConfirmedValue,
    totalIndentValue,
    items,
    rawText: text,
    warnings,
  }
}
