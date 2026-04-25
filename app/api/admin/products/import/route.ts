import { requireAdmin } from "@/lib/api-auth"
import { parseProductRowsFromWorkbook, upsertProductRows } from "@/lib/product-import"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  try {
    const formData = await req.formData()
    const file = formData.get("file")

    if (!(file instanceof File)) {
      return apiError("file is required")
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const rows = parseProductRowsFromWorkbook(buffer)

    if (rows.length === 0) {
      return apiError("No product rows found in workbook")
    }

    const result = await prisma.$transaction((tx) => upsertProductRows(tx, rows))

    return Response.json({
      ...result,
      totalRows: rows.length,
      note: "Products imported. Placeholder itemCode values use KSBCL-PENDING-XXXX for manual update later.",
    })
  } catch {
    return apiError("Database error", 500)
  }
}
