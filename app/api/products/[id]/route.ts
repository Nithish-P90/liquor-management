import { Prisma } from "@prisma/client"
import { z } from "zod"

import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError, zCategory, zCoerceNonNegativeDecimal, zCoercePositiveInt } from "@/lib/zod-schemas"

const updateSizeSchema = z.object({
  id: z.number().int().positive().optional(),
  sizeMl: zCoercePositiveInt,
  bottlesPerCase: zCoercePositiveInt,
  mrp: zCoerceNonNegativeDecimal,
  sellingPrice: zCoerceNonNegativeDecimal,
  barcode: z.string().trim().min(1).optional().nullable(),
})

const patchSchema = z.object({
  itemCode: z.string().trim().min(1).optional(),
  name: z.string().trim().min(2).optional(),
  category: zCategory.optional(),
  sizes: z.array(updateSizeSchema).min(1).optional(),
})

function parseDecimal(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n.toFixed(2))
}

function parseId(params: { id: string }): number | null {
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) return null
  return id
}

export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const productId = parseId(params)
  if (!productId) return apiError("Invalid product id")

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid body")
  }

  const data = parsed.data

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id: productId },
        data: {
          itemCode: data.itemCode,
          name: data.name,
          category: data.category,
        },
      })

      if (data.sizes) {
        const existingSizes = await tx.productSize.findMany({
          where: { productId },
          select: { id: true },
        })

        const keepIds = new Set<number>()

        for (const size of data.sizes) {
          if (size.id) {
            keepIds.add(size.id)
            await tx.productSize.update({
              where: { id: size.id },
              data: {
                sizeMl: size.sizeMl,
                bottlesPerCase: size.bottlesPerCase,
                mrp: parseDecimal(size.mrp),
                sellingPrice: parseDecimal(size.sellingPrice),
                barcode: size.barcode ?? null,
              },
            })
          } else {
            const created = await tx.productSize.create({
              data: {
                productId,
                sizeMl: size.sizeMl,
                bottlesPerCase: size.bottlesPerCase,
                mrp: parseDecimal(size.mrp),
                sellingPrice: parseDecimal(size.sellingPrice),
                barcode: size.barcode ?? null,
              },
              select: { id: true },
            })
            keepIds.add(created.id)
          }
        }

        const deletableIds = existingSizes
          .map((size) => size.id)
          .filter((id) => !keepIds.has(id))

        if (deletableIds.length > 0) {
          await tx.productSize.deleteMany({
            where: { id: { in: deletableIds } },
          })
        }
      }

      return tx.product.findUnique({
        where: { id: product.id },
        include: { sizes: { orderBy: { sizeMl: "desc" } } },
      })
    })

    return Response.json(updated)
  } catch {
    return apiError("Database error", 500)
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const productId = parseId(params)
  if (!productId) return apiError("Invalid product id")

  try {
    await prisma.$transaction(async (tx) => {
      await tx.productSize.deleteMany({ where: { productId } })
      await tx.product.delete({ where: { id: productId } })
    })

    return Response.json({ ok: true })
  } catch {
    return apiError("Database error", 500)
  }
}
