import { Category } from "@prisma/client"

const CATEGORY_RULES: Array<{ category: Category; checks: Array<RegExp> }> = [
  { category: "BEER", checks: [/beer/i, /lager/i, /ale/i, /stout/i] },
  { category: "BRANDY", checks: [/brandy/i] },
  { category: "WHISKY", checks: [/whisky/i, /whiskey/i, /scotch/i, /bourbon/i] },
  { category: "RUM", checks: [/rum/i] },
  { category: "VODKA", checks: [/vodka/i] },
  { category: "GIN", checks: [/\bgin\b/i] },
  { category: "WINE", checks: [/wine/i] },
  { category: "PREMIX", checks: [/premix/i, /breezer/i, /cooler/i] },
  { category: "BEVERAGE", checks: [/soda/i, /water/i, /juice/i, /soft\s?drink/i] },
]

export function inferCategory(productName: string): Category {
  const normalized = productName.trim()

  for (const rule of CATEGORY_RULES) {
    if (rule.checks.some((pattern) => pattern.test(normalized))) {
      return rule.category
    }
  }

  return "MISCELLANEOUS"
}
