import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const staff = await prisma.staff.findMany({ select: { id: true, name: true, role: true, pin: true } })
  console.log('Staff:', staff)
}
main().finally(() => prisma.$disconnect())
