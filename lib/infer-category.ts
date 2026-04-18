import { Category } from '@prisma/client'

/**
 * Infer the liquor category from a product name string.
 * Used by indent upload, bulk product import, etc.
 */
export function inferCategory(itemName: string): Category {
  const name = itemName.toUpperCase()
  if (name.includes('BEER') || name.includes('LAGER')) return Category.BEER
  if (name.includes('BRANDY')) return Category.BRANDY
  if (name.includes('WHISKY') || name.includes('WHISKEY')) return Category.WHISKY
  if (name.includes('RUM')) return Category.RUM
  if (name.includes('VODKA')) return Category.VODKA
  if (name.includes('GIN')) return Category.GIN
  if (name.includes('WINE')) return Category.WINE
  if (name.includes('BREEZER') || name.includes('PREMIX')) return Category.PREMIX
  return Category.WHISKY
}
