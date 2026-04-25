import fs from "node:fs"
import path from "node:path"

import { PrismaClient, Role } from "@prisma/client"

import { parseProductRowsFromWorkbook, upsertProductRows } from "../lib/product-import"

const prisma = new PrismaClient()

function parseArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag)
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1]
  }
  return null
}

function resolveWorkbookPath(): string | null {
  const fromArg = parseArg("--excel")
  if (fromArg) return path.resolve(process.cwd(), fromArg)

  const fromEnv = process.env.PRODUCT_BOOTSTRAP_XLSX
  if (fromEnv) return path.resolve(process.cwd(), fromEnv)

  return null
}

async function ensureStaff(name: string, pin: string, role: Extract<Role, "ADMIN" | "CASHIER">): Promise<void> {
  await prisma.staff.upsert({
    where: { pin },
    update: {
      name,
      role,
      active: true,
    },
    create: {
      name,
      pin,
      role,
      active: true,
    },
  })
}

async function importFromWorkbook(workbookPath: string): Promise<void> {
  if (!fs.existsSync(workbookPath)) {
    console.log(`Workbook not found: ${workbookPath}`)
    return
  }

  const buffer = fs.readFileSync(workbookPath)
  const rows = parseProductRowsFromWorkbook(buffer)

  if (rows.length === 0) {
    console.log("Workbook parsed but no products found")
    return
  }

  const result = await prisma.$transaction((tx) => upsertProductRows(tx, rows))
  console.log(`Imported products. Created size rows: ${result.created}, Updated size rows: ${result.updated}, Errors: ${result.errors.length}`)

  if (result.errors.length > 0) {
    console.log("First 10 import errors:")
    for (const err of result.errors.slice(0, 10)) {
      console.log(`  row ${err.row}: ${err.error}`)
    }
  }
}

async function main(): Promise<void> {
  await ensureStaff("Admin", "1001", "ADMIN")
  await ensureStaff("Cashier", "1002", "CASHIER")

  const workbookPath = resolveWorkbookPath()
  if (workbookPath) {
    await importFromWorkbook(workbookPath)
  } else {
    console.log("No workbook configured. Skipped product import.")
  }

  console.log("Seeding completed")
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
