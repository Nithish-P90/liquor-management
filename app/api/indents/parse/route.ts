import { requireAdmin } from "@/lib/api-auth"
import { parseKsbclPdf } from "@/lib/ksbcl-parser"
import { matchVariants } from "@/lib/ksbcl-match"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"
import { todayDateString } from "@/lib/dates"

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  try {
    const formData = await req.formData()
    const file = formData.get("pdf")
    if (!(file instanceof File)) return apiError("No PDF file provided")

    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = await parseKsbclPdf(buffer)
    const matches = await matchVariants(parsed.items)

    const indentNumber = parsed.indentNumber || `UNKNOWN-${Date.now()}`
    const existing = await prisma.indent.findUnique({ where: { indentNumber } })

    let indentId: number

    if (existing) {
      // Re-parse: update header only, keep existing items unless none exist
      await prisma.indent.update({
        where: { id: existing.id },
        data: {
          rawText: parsed.rawText,
          parseWarnings: parsed.warnings,
          totalIndentValue: parsed.totalIndentValue,
          totalConfirmedValue: parsed.totalConfirmedValue,
        },
      })
      indentId = existing.id
    } else {
      const indent = await prisma.indent.create({
        data: {
          indentNumber,
          invoiceNumber: parsed.invoiceNumber || indentNumber,
          retailerId: parsed.retailerId || "UNKNOWN",
          retailerName: parsed.retailerName || "UNKNOWN",
          indentDate: parsed.indentDate ? new Date(parsed.indentDate) : new Date(todayDateString()),
          pdfPath: file.name,
          rawText: parsed.rawText,
          parseWarnings: parsed.warnings,
          totalIndentValue: parsed.totalIndentValue,
          totalConfirmedValue: parsed.totalConfirmedValue,
        },
      })
      indentId = indent.id

      for (const match of matches) {
        await prisma.indentItem.create({
          data: {
            indentId,
            productId: match.productId ?? undefined,
            productSizeId: match.productSizeId ?? undefined,
            ksbclItemCode: match.parsedItem.ksbclItemCode,
            rawItemName: match.parsedItem.rawItemName || match.parsedItem.itemName,
            parseConfidence: 1.0,
            mappingConfidence: match.confidence,
            isNewItem: match.isNewItem,
            isRationed: match.parsedItem.isRationed,
            ratePerCase: match.parsedItem.ratePerCase,
            indentCases: match.parsedItem.indentCases,
            indentBottles: match.parsedItem.indentBottles,
            indentAmount: match.parsedItem.indentAmount,
            cnfCases: match.parsedItem.cnfCases,
            cnfBottles: match.parsedItem.cnfBottles,
            cnfAmount: match.parsedItem.cnfAmount,
          },
        })
      }
    }

    return Response.json({ indentId, parsed, matches, warnings: parsed.warnings })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Parse failed", 500)
  }
}
