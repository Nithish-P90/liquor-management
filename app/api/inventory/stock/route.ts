import { z } from "zod"

import { prisma } from "@/lib/platform/prisma"
import { requireApiAuth, parseQuery, jsonOk, apiError } from "@/lib/api/handler"
import { calculateStock, splitStock, getStockSnapshot } from "@/lib/domains/inventory/stock"

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(500),
  offset: z.coerce.number().int().nonnegative().default(0),
  search: z.string().trim().optional(),
  category: z.string().trim().optional(),
})

export async function GET(req: Request): Promise<Response> {
  const authResult = await requireApiAuth("session", req)
  if (authResult instanceof Response) return authResult

  const queryOrError = parseQuery(req, querySchema)
  if (queryOrError instanceof Response) return queryOrError

  const { limit, offset, search, category } = queryOrError

  try {
    const session = await prisma.inventorySession.findFirst({
      where: { locked: false },
      orderBy: { id: "desc" },
      select: { id: true },
    })

    const sizes = await prisma.productSize.findMany({
      where: {
        product: {
          ...(category ? { category: category as never } : {}),
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { itemCode: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        ...(search
          ? {
              OR: [
                { product: { name: { contains: search, mode: "insensitive" } } },
                { ksbclItemCode: { contains: search, mode: "insensitive" } },
                { barcode: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        sizeMl: true,
        bottlesPerCase: true,
        barcode: true,
        ksbclItemCode: true,
        mrp: true,
        sellingPrice: true,
        product: {
          select: {
            id: true,
            name: true,
            itemCode: true,
            category: true,
          },
        },
      },
      orderBy: [{ product: { name: "asc" } }, { sizeMl: "desc" }],
      take: limit,
      skip: offset,
    })

    const sizeIds = sizes.map((s) => s.id)

    // Batch stock calculation
    const stockMap = session
      ? await prisma.$transaction((tx) =>
          getStockSnapshot(tx, { sessionId: session.id, productSizeIds: sizeIds }),
        )
      : new Map()

    const items = sizes.map((size) => {
      const stock = stockMap.get(size.id)
      const totalBottles = stock?.totalBottles ?? 0
      const normalized = splitStock(totalBottles, size.bottlesPerCase)
      return {
        productSizeId: size.id,
        productId: size.product.id,
        name: size.product.name,
        category: size.product.category,
        itemCode: size.product.itemCode,
        ksbclItemCode: size.ksbclItemCode,
        barcode: size.barcode,
        sizeMl: size.sizeMl,
        bottlesPerCase: size.bottlesPerCase,
        mrp: size.mrp,
        sellingPrice: size.sellingPrice,
        openingBottles: stock?.openingBottles ?? 0,
        receiptBottles: stock?.receiptBottles ?? 0,
        soldBottles: stock?.soldBottles ?? 0,
        totalBottles,
        cases: normalized.cases,
        bottles: normalized.bottles,
      }
    })

    const total = await prisma.productSize.count()

    return jsonOk({ sessionId: session?.id ?? null, items, total })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Failed to fetch stock", 500)
  }
}
