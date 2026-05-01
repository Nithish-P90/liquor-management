import { type ParsedIndentItem } from "@/lib/ksbcl-parser"
import { prisma } from "@/lib/prisma"

export type MatchResult = {
  parsedItem: ParsedIndentItem
  productSizeId: number | null
  productId: number | null
  confidence: number
  isNewItem: boolean
  matchReason: string
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function stringSimilarity(a: string, b: string): number {
  const na = normalizeForMatch(a)
  const nb = normalizeForMatch(b)
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.85

  // Bigram similarity
  function bigrams(str: string): Set<string> {
    const bg = new Set<string>()
    for (let i = 0; i < str.length - 1; i++) bg.add(str.slice(i, i + 2))
    return bg
  }
  const ba = bigrams(na)
  const bb = bigrams(nb)
  if (ba.size === 0 || bb.size === 0) return 0
  let intersection = 0
  ba.forEach((bg) => { if (bb.has(bg)) intersection++ })
  return (2 * intersection) / (ba.size + bb.size)
}

export async function matchVariants(items: ParsedIndentItem[]): Promise<MatchResult[]> {
  const allSizes = await prisma.productSize.findMany({
    include: { product: { select: { name: true, itemCode: true } } },
  })

  return items.map((item) => {
    // Exact ksbclItemCode match
    const exactCode = allSizes.find((s) => s.ksbclItemCode === item.ksbclItemCode)
    if (exactCode) {
      return {
        parsedItem: item,
        productSizeId: exactCode.id,
        productId: exactCode.productId,
        confidence: 1.0,
        isNewItem: false,
        matchReason: "exact_ksbcl_code",
      }
    }

    // Fuzzy: name + size match
    let best: { size: typeof allSizes[0]; score: number } | null = null
    for (const size of allSizes) {
      if (size.sizeMl !== item.sizeMl) continue
      const nameSim = stringSimilarity(size.product.name, item.itemName)
      if (!best || nameSim > best.score) best = { size, score: nameSim }
    }

    if (best && best.score >= 0.7) {
      return {
        parsedItem: item,
        productSizeId: best.size.id,
        productId: best.size.productId,
        confidence: best.score,
        isNewItem: false,
        matchReason: "fuzzy_name_size",
      }
    }

    return {
      parsedItem: item,
      productSizeId: null,
      productId: null,
      confidence: best?.score ?? 0,
      isNewItem: true,
      matchReason: "no_match",
    }
  })
}
