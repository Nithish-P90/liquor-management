import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const res = await prisma.staff.updateMany({
    where: { role: { not: 'CASHIER' } },
    data: { pin: null },
  })
  console.log('Cleared pins for non-cashier staff, updated count:', res.count)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
