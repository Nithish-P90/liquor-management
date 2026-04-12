/**
 * Stock utility functions for normalizing stock entries and converting
 * between total-bottles ↔ cases+bottles representations.
 *
 * Used by the inventory opening/closing/current API routes.
 */

/**
 * Normalize a stock entry: overflow extra loose bottles into cases.
 *
 * Example: 2 cases + 15 bottles with bottlesPerCase=12
 *  → 3 cases + 3 bottles → 39 totalBottles
 */
export function normalizeStockEntry(
  cases: number,
  bottles: number,
  bottlesPerCase: number
): { cases: number; bottles: number; totalBottles: number } {
  const totalBottles = cases * bottlesPerCase + bottles
  const normalizedCases = Math.floor(totalBottles / bottlesPerCase)
  const normalizedBottles = totalBottles % bottlesPerCase

  return {
    cases: normalizedCases,
    bottles: normalizedBottles,
    totalBottles,
  }
}

/**
 * Split a total-bottle count into cases and loose bottles.
 *
 * Used by the /api/inventory/current route to display stock in
 * a human-friendly "X cases, Y bottles" format.
 */
export function splitStock(
  totalBottles: number,
  bottlesPerCase: number
): { cases: number; bottles: number } {
  return {
    cases: Math.floor(totalBottles / bottlesPerCase),
    bottles: totalBottles % bottlesPerCase,
  }
}
