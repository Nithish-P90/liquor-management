
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('--- Starting Factory Reset ---')

  // Order matters for foreign keys
  const tables = [
    'AuditEvent',
    'AttendanceEvent',
    'AttendanceLog',
    'PaymentAllocation',
    'BillLine',
    'GallaEvent',
    'GallaDay',
    'LockerEvent',
    'LockerRecord',
    'StockAdjustment',
    'VarianceRecord',
    'ReceiptItem',
    'Receipt',
    'IndentItem',
    'Indent',
    'StockEntry',
    'InventorySession',
    'PhysicalCountItem',
    'PhysicalCountSession',
    'CashierShortageDeduction',
    'CashierSettlement',
    'ClearanceBatch',
    'Bill',
    'DailySnapshot',
    'Notification'
  ]

  for (const table of tables) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`)
      console.log(`Truncated ${table}`)
    } catch (e) {
      console.log(`Failed to truncate ${table} (might not exist yet): ${e.message}`)
    }
  }

  // Reset Clerk Sales (if we want to keep clerks but reset metrics)
  // Actually, TRUNCATE Bill handles the relationship.

  // Optional: Reset specific record balances
  // await prisma.lockerRecord.create({ data: { balance: 0 } })

  console.log('--- Reset Completed ---')
}

main().catch(console.error).finally(() => prisma.$disconnect())
