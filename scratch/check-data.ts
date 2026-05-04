
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const bills = await prisma.bill.count()
  const lines = await prisma.billLine.count()
  const adjustments = await prisma.stockAdjustment.count()
  const galla = await prisma.gallaEvent.count()
  const sessions = await prisma.inventorySession.count()
  const products = await prisma.product.count()
  const sizes = await prisma.productSize.count()
  
  console.log({ bills, lines, adjustments, galla, sessions, products, sizes })
}

main().catch(console.error).finally(() => prisma.$disconnect())
