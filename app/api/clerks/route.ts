import { z } from "zod"
import { requireAdmin, requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"
import { REVENUE_BILL_WHERE } from "@/lib/domains/billing/bill"

export async function GET(): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  try {
    // Sync: Ensure 'Counter' and all active staff suppliers have a clerk record
    const [activeSuppliers, existingClerks] = await Promise.all([
      prisma.staff.findMany({
        where: { role: "SUPPLIER", active: true },
        select: { name: true },
      }),
      prisma.clerk.findMany({
        where: { isActive: true },
        select: { name: true },
      }),
    ])

    const existingNames = new Set(existingClerks.map((c) => c.name.toLowerCase()))
    
    // Ensure 'Counter' exists
    if (!existingNames.has("counter")) {
      await prisma.clerk.create({ data: { name: "Counter" } })
    }

    const missing = activeSuppliers.filter((s) => !existingNames.has(s.name.toLowerCase()) && s.name.toLowerCase() !== "counter")

    if (missing.length > 0) {
      // Use createMany if possible, but manual check is safer for duplicates without unique constraint
      // However, we already filtered 'missing' above.
      await prisma.clerk.createMany({
        data: missing.map((s) => ({ name: s.name })),
      })
    }

    const clerks = await prisma.clerk.findMany({
      where: { isActive: true },
      include: {
        bills: {
          where: {
            ...REVENUE_BILL_WHERE
          },
          select: { netCollectible: true }
        }
      },
      orderBy: { name: "asc" },
    })

    const result = clerks.map(({ bills, ...rest }) => {
      const totalSales = bills.reduce((sum, b) => sum + Number(b.netCollectible), 0)
      return {
        ...rest,
        metrics: {
          billsHandled: bills.length,
          totalSales: totalSales
        }
      }
    })

    return Response.json(result)
  } catch (err) {
    console.error("Clerks sync error:", err)
    return apiError("Database error", 500)
  }
}

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const parsed = z.object({ name: z.string().trim().min(1) }).safeParse(await req.json())
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid body")

  try {
    const clerk = await prisma.clerk.create({ data: { name: parsed.data.name } })
    return Response.json(clerk, { status: 201 })
  } catch {
    return apiError("Database error", 500)
  }
}
