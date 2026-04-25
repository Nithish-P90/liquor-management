"use server"

import { getServerSession } from "next-auth"
import { z } from "zod"

import { authOptions } from "@/lib/auth"
import { commitBill, openTab, settleTab, voidBill } from "@/lib/bill"
import { prisma } from "@/lib/prisma"
import { zPaymentMode, zScanMethod } from "@/lib/zod-schemas"

const zLine = z.object({
  productSizeId: z.number().int().positive().optional(),
  miscItemId: z.number().int().positive().optional(),
  itemNameSnapshot: z.string().min(1),
  barcodeSnapshot: z.string().optional(),
  quantity: z.number().int().positive(),
  scanMethod: zScanMethod.optional(),
  isManualOverride: z.boolean().optional(),
  overrideReason: z.string().optional(),
})

const zPayment = z.object({
  mode: zPaymentMode,
  amount: z.number().positive(),
  reference: z.string().optional(),
})

const zCommit = z.object({
  attributionType: z.enum(["COUNTER", "CLERK"]).optional(),
  clerkId: z.number().int().positive().optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  discountTotal: z.number().nonnegative().optional(),
  discountReason: z.string().optional(),
  notes: z.string().optional(),
  lines: z.array(zLine).min(1),
  payments: z.array(zPayment).min(1),
})

const zTab = z.object({
  attributionType: z.enum(["COUNTER", "CLERK"]).optional(),
  clerkId: z.number().int().positive().optional(),
  customerName: z.string().optional(),
  notes: z.string().optional(),
  lines: z.array(zLine).min(1),
})

type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string }

async function getOperatorId(): Promise<number | null> {
  const session = await getServerSession(authOptions)
  return session?.user?.id ? parseInt(session.user.id, 10) : null
}

export async function posCommit(
  raw: unknown,
): Promise<ActionResult<{ billId: number; billNumber: string }>> {
  const operatorId = await getOperatorId()
  if (!operatorId) return { ok: false, error: "Unauthorized" }

  const parsed = zCommit.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  try {
    const billId = await prisma.$transaction(async (tx) => {
      return commitBill(tx, { ...parsed.data, operatorId })
    })
    const bill = await prisma.bill.findUniqueOrThrow({
      where: { id: billId },
      select: { billNumber: true },
    })
    return { ok: true, data: { billId, billNumber: bill.billNumber } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Commit failed" }
  }
}

export async function posOpenTab(
  raw: unknown,
): Promise<ActionResult<{ billId: number; billNumber: string }>> {
  const operatorId = await getOperatorId()
  if (!operatorId) return { ok: false, error: "Unauthorized" }

  const parsed = zTab.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  try {
    const billId = await prisma.$transaction(async (tx) => {
      return openTab(tx, { ...parsed.data, operatorId })
    })
    const bill = await prisma.bill.findUniqueOrThrow({
      where: { id: billId },
      select: { billNumber: true },
    })
    return { ok: true, data: { billId, billNumber: bill.billNumber } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Open tab failed" }
  }
}

export async function posSettleTab(
  billId: number,
  payments: Array<{ mode: string; amount: number; reference?: string }>,
): Promise<ActionResult> {
  const operatorId = await getOperatorId()
  if (!operatorId) return { ok: false, error: "Unauthorized" }

  const parsed = z.array(zPayment).safeParse(payments)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid payments" }

  try {
    await prisma.$transaction(async (tx) => {
      await settleTab(tx, { billId, actorId: operatorId, payments: parsed.data })
    })
    return { ok: true, data: undefined }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Settle failed" }
  }
}

export async function posVoid(billId: number, reason: string): Promise<ActionResult> {
  const operatorId = await getOperatorId()
  if (!operatorId) return { ok: false, error: "Unauthorized" }

  if (!reason.trim()) return { ok: false, error: "Void reason required" }

  try {
    await prisma.$transaction(async (tx) => {
      await voidBill(tx, { billId, actorId: operatorId, reason })
    })
    return { ok: true, data: undefined }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Void failed" }
  }
}
