import { IndentStatus } from "@prisma/client"

import { PrismaTransactionClient } from "@/lib/domains/inventory/stock"

export async function confirmArrival(
  tx: PrismaTransactionClient,
  indentId: number,
  actorId: number,
): Promise<void> {
  const indent = await tx.indent.findUniqueOrThrow({
    where: { id: indentId },
    include: { items: true },
  })

  if (indent.status === IndentStatus.STOCK_ADDED) {
    throw new Error("Arrival already confirmed for this indent")
  }

  const unmapped = indent.items.filter((item) => item.isNewItem)
  if (unmapped.length > 0) {
    throw new Error(
      `${unmapped.length} items are unresolved (isNewItem=true). Map them before confirming.`,
    )
  }

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const receipt = await tx.receipt.create({
    data: {
      indentId,
      receivedDate: today,
      staffId: actorId,
    },
  })

  for (const item of indent.items) {
    if (!item.productSizeId) continue
    const totalBottles = item.cnfCases * (
      await tx.productSize.findUniqueOrThrow({
        where: { id: item.productSizeId },
        select: { bottlesPerCase: true },
      })
    ).bottlesPerCase + item.cnfBottles

    await tx.receiptItem.create({
      data: {
        receiptId: receipt.id,
        productSizeId: item.productSizeId,
        casesReceived: item.cnfCases,
        bottlesReceived: item.cnfBottles,
        totalBottles,
      },
    })
  }

  await tx.indent.update({
    where: { id: indentId },
    data: { status: IndentStatus.STOCK_ADDED },
  })

  await tx.auditEvent.create({
    data: {
      actorId,
      eventType: "INDENT_CONFIRMED",
      entity: "Indent",
      entityId: indentId,
      afterSnapshot: { receiptId: receipt.id },
    },
  })
}
