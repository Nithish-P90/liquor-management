import { prisma } from "@/lib/prisma"

export type AlertSeverity = "INFO" | "WARN" | "CRITICAL"

export async function raiseAlert(params: {
  type: string
  title: string
  body: string
  severity?: AlertSeverity
  refEntity?: string
  refEntityId?: number
}): Promise<void> {
  // Dedup: if an unread alert of same type+ref exists, skip
  if (params.refEntity && params.refEntityId) {
    const existing = await prisma.notification.findFirst({
      where: {
        type: params.type,
        refEntity: params.refEntity,
        refEntityId: params.refEntityId,
        dismissedAt: null,
      },
    })
    if (existing) return
  }

  await prisma.notification.create({
    data: {
      type: params.type,
      title: params.title,
      body: params.body,
      severity: params.severity ?? "INFO",
      refEntity: params.refEntity,
      refEntityId: params.refEntityId,
    },
  })
}

export async function dismissAlert(id: number): Promise<void> {
  await prisma.notification.update({
    where: { id },
    data: { dismissedAt: new Date(), read: true },
  })
}

export async function listActiveAlerts(limit = 50) {
  return prisma.notification.findMany({
    where: { dismissedAt: null },
    orderBy: { createdAt: "desc" },
    take: limit,
  })
}
