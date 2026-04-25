import { Prisma } from "@prisma/client"
import { z } from "zod"

import { requireAdmin, requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import {
  apiError,
  zCategory,
  zCoercePositiveInt,
  zCoerceNonNegativeDecimal,
} from "@/lib/zod-schemas"

const querySchema = z.object({
  category: zCategory.optional(),
  search: z.string().trim().min(1).optional(),
  limit: zCoercePositiveInt.max(200).optional(),
})

const sizeSchema = z.object({
  sizeMl: zCoercePositiveInt,
  bottlesPerCase: zCoercePositiveInt,
  mrp: zCoerceNonNegativeDecimal,
  sellingPrice: zCoerceNonNegativeDecimal,
  barcode: z.string().trim().min(1).optional(),
})

const createSchema = z.object({
  itemCode: z.string().trim().min(1),
  name: z.string().trim().min(2),
  category: zCategory,
  sizes: z.array(sizeSchema).min(1),
})

function parseDecimal(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n.toFixed(2))
}

export async function GET(req: Request): Promise<Response> {
  const authResult = await requireSession()
  if (authResult instanceof Response) return authResult

  const url = new URL(req.url)
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams))

  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid query")
  }

  const { category, search, limit } = parsed.data

  const where: Prisma.ProductWhereInput = {
    ...(category ? { category } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { itemCode: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  }

  try {
    const products = await prisma.product.findMany({
      where,
      include: {
        sizes: {
          orderBy: { sizeMl: "desc" },
        },
      },
      take: limit ?? 100,
      orderBy: [{ name: "asc" }],
    })

    return Response.json(products)
  } catch {
    return apiError("Database error", 500)
  }
}

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid body")
  }

  const data = parsed.data

  try {
    const existing = await prisma.product.findUnique({
      where: { itemCode: data.itemCode },
      select: { id: true },
    })

    if (existing) {
      return apiError("itemCode already exists", 409)
    }

    const product = await prisma.product.create({
      data: {
        itemCode: data.itemCode,
        name: data.name,
        category: data.category,
        sizes: {
          create: data.sizes.map((size) => ({
            sizeMl: size.sizeMl,
            bottlesPerCase: size.bottlesPerCase,
            mrp: parseDecimal(size.mrp),
            sellingPrice: parseDecimal(size.sellingPrice),
            barcode: size.barcode,
          })),
        },
      },
      include: {
        sizes: {
          orderBy: { sizeMl: "desc" },
        },
      },
    })

    return Response.json(product, { status: 201 })
  } catch {
    return apiError("Database error", 500)
  }
}
