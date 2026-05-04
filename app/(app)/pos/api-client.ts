// Typed REST wrappers replacing the old "use server" actions.
// All return { ok: true, data } | { ok: false, error } matching prior action shape.

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string }

async function post<T>(path: string, body: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) return { ok: false, error: json.error ?? "Request failed" }
    return { ok: true, data: json as T }
  } catch {
    return { ok: false, error: "Network error" }
  }
}

export type PricedCart = {
  lines: Array<{
    key: string
    kind: "LIQUOR" | "MISC"
    itemName: string
    unitPrice: number
    quantity: number
    lineTotal: number
    isThirdParty: boolean
    availableStock: number | null
  }>
  total: number
  ownerSubtotal: number
  thirdPartySubtotal: number
  warnings: string[]
}

export type BillLine = {
  productSizeId?: number
  miscItemId?: number
  itemNameSnapshot: string
  barcodeSnapshot?: string
  quantity: number
  scanMethod?: string
  isManualOverride?: boolean
  overrideReason?: string
}

export type Payment = { mode: string; amount: number; reference?: string }

export function postCompute(lines: Array<{ kind: "LIQUOR" | "MISC"; productSizeId?: number; miscItemId?: number; quantity: number }>): Promise<Result<PricedCart>> {
  return post<PricedCart>("/api/pos/bills/compute", { lines })
}

export function postCommit(body: {
  attributionType?: string
  clerkId?: number
  customerName?: string
  lines: BillLine[]
  payments: Payment[]
  discountTotal?: number
  discountReason?: string
}): Promise<Result<{ billId: number; billNumber: string }>> {
  return post("/api/pos/bills/commit", body)
}

export function postOpenTab(body: {
  attributionType?: string
  clerkId?: number
  customerName?: string
  lines: BillLine[]
}): Promise<Result<{ billId: number; billNumber: string }>> {
  return post("/api/pos/bills/open-tab", body)
}

export function postAddToTab(tabId: number, body: {
  lines: BillLine[]
}): Promise<Result<{ billId: number; billNumber: string }>> {
  return post("/api/pos/bills/open-tab", { ...body, existingBillId: tabId })
}

export function postSettleTab(billId: number, payments: Payment[]): Promise<Result<{ ok: boolean }>> {
  return post("/api/pos/bills/settle-tab", { billId, payments })
}

export function postReturn(body: {
  clerkId: number
  reason: string
  lines: Array<{ productSizeId?: number; miscItemId?: number; itemNameSnapshot: string; quantity: number; unitPrice: number }>
}): Promise<Result<{ billNumber: string }>> {
  return post("/api/pos/bills/return", body)
}

export function postVoid(billId: number, reason: string): Promise<Result<{ ok: boolean }>> {
  return post("/api/pos/bills/void", { billId, reason })
}
