import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  try {
    const [activeSuppliers, existingClerks] = await Promise.all([
      prisma.staff.findMany({
        where: { role: "SUPPLIER", active: true },
        select: { name: true },
      }),
      prisma.clerk.findMany({
        where: { isActive: true },
        select: { name: true },
      }),
    ])
    console.log('Suppliers:', activeSuppliers)
    console.log('Clerks:', existingClerks)
    
    const existingNames = new Set(existingClerks.map((c) => c.name.toLowerCase()))
    const missing = activeSuppliers.filter((s) => !existingNames.has(s.name.toLowerCase()))
    console.log('Missing:', missing)

    if (missing.length > 0) {
      const result = await prisma.clerk.createMany({
        data: missing.map((s) => ({ name: s.name })),
      })
      console.log('CreateMany result:', result)
    }
  } catch (err) {
    console.error('Error in sync logic:', err)
  }
}
main().finally(() => prisma.$disconnect())
