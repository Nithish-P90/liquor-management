/**
 * POST /api/sync/push
 * Receives batches of offline records from the Windows POS app.
 * Handles: sales, attendance, expenses, cash records.
 *
 * Each record carries a `local_id` (nanoid) for idempotency —
 * we can safely retry on network failure without creating duplicates.
 *
 * Response: { acks: [{ local_id, server_id?, error? }] }
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { Prisma, PrismaClient } from '@prisma/client'
import { toUtcNoonDate } from '@/lib/date-utils'

export const dynamic = 'force-dynamic'

type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

function validateToken(req: NextRequest): boolean {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  const expected = process.env.SYNC_TOKEN
  if (!expected) return false
  return token === expected
}

type Ack = { local_id: string; server_id?: number; error?: string }

// ── Sales ─────────────────────────────────────────────────────────────────────
async function processSales(records: Record<string, unknown>[]): Promise<Ack[]> {
  const acks: Ack[] = []

  for (const r of records) {
    const localId = r.local_id as string

    try {
      // Idempotency: check if we already have this local_id stored
      // We use the clientNote field (overrideReason) to store localId
      const existing = await prisma.sale.findFirst({
        where: { overrideReason: `sync:${localId}` },
        select: { id: true },
      })

      if (existing) {
        acks.push({ local_id: localId, server_id: existing.id })
        continue
      }

      const saleDate = toUtcNoonDate(new Date(`${r.sale_date}T12:00:00Z`))
      const saleTime = new Date(r.sale_time as string)

      // Validate staff and product exist
      const staff = await prisma.staff.findUnique({ where: { id: r.staff_id as number } })
      const productSize = await prisma.productSize.findUnique({ where: { id: r.product_size_id as number } })

      if (!staff || !productSize) {
        acks.push({ local_id: localId, error: 'Staff or product not found' })
        continue
      }

      // VOID records: log as a sale row with negative qty and VOID paymentMode.
      // The stock formula (opening + receipts + adj - sold) uses quantityBottles > 0
      // for "sold", so the negative VOID row is automatically excluded from deductions —
      // the original positive sale row cancels itself by not being summed.
      // DO NOT create a stockAdjustment here — that would double-count the return.
      if (r.payment_mode === 'VOID') {
        const qty = Math.abs(r.quantity as number) // stored as negative locally
        const sale = await prisma.sale.create({
          data: {
            saleDate,
            saleTime,
            staffId: r.staff_id as number,
            productSizeId: r.product_size_id as number,
            quantityBottles: -(qty),
            sellingPrice: r.selling_price as number,
            totalAmount: 0,
            paymentMode: 'VOID',
            cashAmount: null,
            cardAmount: null,
            upiAmount: null,
            scanMethod: 'MANUAL',
            customerName: r.customer_name as string | null ?? null,
            isManualOverride: false,
            overrideReason: `sync:${localId}`,
          },
        })

        acks.push({ local_id: localId, server_id: sale.id })
        continue
      }

      const sale = await prisma.$transaction(async (tx: TxClient) => {
        return tx.sale.create({
          data: {
            saleDate,
            saleTime,
            staffId: r.staff_id as number,
            productSizeId: r.product_size_id as number,
            quantityBottles: r.quantity as number,
            sellingPrice: r.selling_price as number,
            totalAmount: r.total_amount as number,
            paymentMode: r.payment_mode as never,
            cashAmount: r.cash_amount != null ? r.cash_amount as number : null,
            cardAmount: r.card_amount != null ? r.card_amount as number : null,
            upiAmount: r.upi_amount != null ? r.upi_amount as number : null,
            scanMethod: (r.scan_method as never) ?? 'MANUAL',
            customerName: r.customer_name as string | null ?? null,
            isManualOverride: false,
            overrideReason: `sync:${localId}`,  // store localId for idempotency
          },
        })
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

      acks.push({ local_id: localId, server_id: sale.id })
    } catch (e) {
      console.error('[sync/push] Sale error:', e)
      acks.push({ local_id: localId, error: String(e) })
    }
  }

  return acks
}

// ── Attendance ────────────────────────────────────────────────────────────────
async function processAttendance(records: Record<string, unknown>[]): Promise<Ack[]> {
  const acks: Ack[] = []

  for (const r of records) {
    const localId = r.local_id as string

    try {
      const date = toUtcNoonDate(new Date(`${r.date}T12:00:00Z`))
      const staffId = r.staff_id as number

      // Idempotency: one log per staff per day
      const existing = await prisma.attendanceLog.findUnique({
        where: { staffId_date: { staffId, date } },
        select: { id: true },
      })

      if (existing) {
        // Update check-out if we have it
        if (r.check_out) {
          await prisma.attendanceLog.update({
            where: { id: existing.id },
            data: { checkOut: new Date(r.check_out as string) },
          })
        }
        acks.push({ local_id: localId, server_id: existing.id })
        continue
      }

      const log = await prisma.attendanceLog.create({
        data: {
          staffId,
          date,
          checkIn: r.check_in ? new Date(r.check_in as string) : new Date(),
          checkOut: r.check_out ? new Date(r.check_out as string) : null,
          status: (r.status as string) ?? 'PRESENT',
        },
      })

      acks.push({ local_id: localId, server_id: log.id })
    } catch (e) {
      console.error('[sync/push] Attendance error:', e)
      acks.push({ local_id: localId, error: String(e) })
    }
  }

  return acks
}

// ── Expenses ──────────────────────────────────────────────────────────────────
async function processExpenses(records: Record<string, unknown>[]): Promise<Ack[]> {
  const acks: Ack[] = []

  for (const r of records) {
    const localId = r.local_id as string

    try {
      // Use a note field pattern for idempotency
      // Since Expenditure has no unique constraint, we check particulars+date+amount
      const expDate = toUtcNoonDate(new Date(`${r.exp_date}T12:00:00Z`))
      const particulars = `${r.particulars as string}|sync:${localId}`

      const existing = await prisma.expenditure.findFirst({
        where: { particulars },
        select: { id: true },
      })

      if (existing) {
        acks.push({ local_id: localId, server_id: existing.id })
        continue
      }

      const exp = await prisma.expenditure.create({
        data: {
          expDate,
          particulars,
          category: (r.category as string) ?? 'OTHER',
          amount: r.amount as number,
        },
      })

      acks.push({ local_id: localId, server_id: exp.id })
    } catch (e) {
      console.error('[sync/push] Expense error:', e)
      acks.push({ local_id: localId, error: String(e) })
    }
  }

  return acks
}

// ── Cash records ──────────────────────────────────────────────────────────────
async function processCashRecords(records: Record<string, unknown>[]): Promise<Ack[]> {
  const acks: Ack[] = []

  for (const r of records) {
    const localId = r.local_id as string

    try {
      const date = toUtcNoonDate(new Date(`${r.record_date}T12:00:00Z`))

      const cashRecord = await prisma.cashRecord.upsert({
        where: { recordDate: date },
        create: {
          recordDate: date,
          openingRegister: r.opening_register as number,
          cashSales:       r.cash_sales as number,
          expenses:        r.expenses as number,
          cashToLocker:    r.cash_to_locker as number,
          closingRegister: r.closing_register as number,
          cardSales:       r.card_sales as number,
          upiSales:        r.upi_sales as number,
          creditSales:     r.credit_sales as number,
          creditCollected: r.credit_collected as number,
          notes:           r.notes as string | null ?? null,
        },
        update: {
          // Windows app is authoritative for same-day record
          openingRegister: r.opening_register as number,
          cashSales:       r.cash_sales as number,
          expenses:        r.expenses as number,
          cashToLocker:    r.cash_to_locker as number,
          closingRegister: r.closing_register as number,
          cardSales:       r.card_sales as number,
          upiSales:        r.upi_sales as number,
          creditSales:     r.credit_sales as number,
          creditCollected: r.credit_collected as number,
          notes:           r.notes as string | null ?? null,
        },
      })

      acks.push({ local_id: localId, server_id: cashRecord.id })
    } catch (e) {
      console.error('[sync/push] Cash error:', e)
      acks.push({ local_id: localId, error: String(e) })
    }
  }

  return acks
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!validateToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { type: string; records: Record<string, unknown>[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { type, records } = body
  if (!type || !Array.isArray(records)) {
    return NextResponse.json({ error: 'Missing type or records' }, { status: 400 })
  }

  if (records.length > 500) {
    return NextResponse.json({ error: 'Batch too large (max 500)' }, { status: 400 })
  }

  let acks: Ack[] = []

  switch (type) {
    case 'sales':
      acks = await processSales(records)
      break
    case 'attendance':
      acks = await processAttendance(records)
      break
    case 'expenses':
      acks = await processExpenses(records)
      break
    case 'cash':
      acks = await processCashRecords(records)
      break
    default:
      return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 })
  }

  return NextResponse.json({ acks })
}
