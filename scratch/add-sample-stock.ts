import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  // 1. Get an admin staff for audit trail
  const admin = await prisma.staff.findFirst({
    where: { role: "ADMIN" }
  })

  if (!admin) {
    console.error("No admin staff found. Please create one first.")
    return
  }

  // 2. Create or get an active inventory session
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  let session = await prisma.inventorySession.findFirst({
    where: { periodStart: { lte: today }, periodEnd: { gte: today } },
    orderBy: { periodStart: "desc" }
  })

  if (!session) {
    session = await prisma.inventorySession.create({
      data: {
        periodStart: today,
        periodEnd: today,
        staffId: admin.id
      }
    })
    console.log(`Created new inventory session #${session.id}`)
  } else {
    console.log(`Using existing inventory session #${session.id}`)
  }

  // 3. Get all products
  const sizes = await prisma.productSize.findMany({
    include: { product: true }
  })

  console.log(`Adding stock for ${sizes.length} variants...`)

  for (const size of sizes) {
    // Add 10-50 bottles for each item
    const bottles = Math.floor(Math.random() * 40) + 10
    
    await prisma.stockEntry.upsert({
      where: {
        sessionId_productSizeId_entryType: {
          sessionId: session.id,
          productSizeId: size.id,
          entryType: "OPENING"
        }
      },
      update: {
        bottles: bottles,
        totalBottles: bottles
      },
      create: {
        sessionId: session.id,
        productSizeId: size.id,
        entryType: "OPENING",
        bottles: bottles,
        totalBottles: bottles
      }
    })
    console.log(`Added ${bottles} bottles for ${size.product.name} (${size.sizeMl}ml)`)
  }

  console.log("Sample stock added successfully.")
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect()
  })
