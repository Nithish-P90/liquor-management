import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const clerks = await prisma.clerk.findMany({
    where: { name: { contains: 'manju', mode: 'insensitive' } }
  })
  console.log('Clerks matching "manju":')
  console.table(clerks)
}

main().catch(console.error).finally(() => prisma.$disconnect())
