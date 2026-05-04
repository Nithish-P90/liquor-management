import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/platform/prisma"
import { todayDateString, parseDateParam } from "@/lib/platform/dates"
import { ensureDailyRollover } from "@/lib/domains/inventory/rollover"

export type BillingPreconditionResult =
  | { ok: true; operatorId: number; sessionId: number }
  | { ok: false; error: string; status: 401 | 409 }

/**
 * Checks auth, GallaDay lock, and active InventorySession.
 * Centralises the three checks that were duplicated across every server action.
 */
export async function checkBillingPreconditions(): Promise<BillingPreconditionResult> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized", status: 401 }
  }
  if (session.user.id === "fallback-admin") {
    return { ok: false, error: "Emergency Admin cannot process sales. Log in with a Staff PIN.", status: 401 }
  }
  const operatorId = parseInt(session.user.id, 10)
  if (isNaN(operatorId)) {
    return { ok: false, error: "Unauthorized", status: 401 }
  }

  const today = parseDateParam(todayDateString())

  const gallaDay = await prisma.gallaDay.findUnique({
    where: { businessDate: today },
    select: { isClosed: true },
  })
  if (gallaDay?.isClosed) {
    return { ok: false, error: "Day is closed. Sales resume after midnight rollover.", status: 409 }
  }

  const inventorySession = await prisma.inventorySession.findFirst({
    where: { periodStart: { lte: today }, periodEnd: { gte: today }, locked: false },
    orderBy: { id: "desc" },
    select: { id: true },
  })
  if (!inventorySession) {
    await ensureDailyRollover()

    const rolledSession = await prisma.inventorySession.findFirst({
      where: { periodStart: { lte: today }, periodEnd: { gte: today }, locked: false },
      orderBy: { id: "desc" },
      select: { id: true },
    })
    if (!rolledSession) {
      return { ok: false, error: "No active inventory session. Day rollover may be pending.", status: 409 }
    }

    return { ok: true, operatorId, sessionId: rolledSession.id }
  }

  return { ok: true, operatorId, sessionId: inventorySession.id }
}
