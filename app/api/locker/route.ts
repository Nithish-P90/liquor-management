import { z } from "zod"

import { requireSession } from "@/lib/api-auth"
import { prisma } from "@/lib/platform/prisma"
import { getOrCreateLocker, computeLockerBalance, depositLockerToBank } from "@/lib/domains/cash/locker"
import type { PrismaTransactionClient } from "@/lib/domains/inventory/stock"

export async function GET(): Promise<Response> {
  const auth = await requireSession()
  if (auth instanceof Response) return auth

  try {
    const locker = await prisma.$transaction(async (tx) => {
      const record = await getOrCreateLocker(tx as unknown as PrismaTransactionClient)
      const balance = await computeLockerBalance(tx as unknown as PrismaTransactionClient, record.id)
      const events = await tx.lockerEvent.findMany({
        where: { lockerId: record.id },
        orderBy: { occurredAt: "desc" },
        take: 50,
      })
      return { id: record.id, balance: balance.toString(), events }
    })
    return Response.json(locker)
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 })
  }
}

const depositSchema = z.object({
  amount: z.number().positive(),
  reference: z.string().optional(),
})

export async function POST(req: Request): Promise<Response> {
  const auth = await requireSession()
  if (auth instanceof Response) return auth

  const parsed = depositSchema.safeParse(await req.json())
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 })
  }

  try {
    await prisma.$transaction(async (tx) => {
      await depositLockerToBank(tx as unknown as PrismaTransactionClient, parsed.data)
    })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Deposit failed" }, { status: 400 })
  }
}
