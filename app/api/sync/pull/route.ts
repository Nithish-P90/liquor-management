/**
 * GET /api/sync/pull
 * Returns everything the Windows POS app needs to operate:
 *  - Product catalog with current stock levels
 *  - Active staff with face profiles
 *  - Today's cloud cash record (if any) for opening balance reference
 *
 * This is a read-only endpoint. The Windows app caches this locally.
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

import { validateBearerToken } from '@/lib/api-auth'

export async function GET(req: NextRequest) {
  if (!validateBearerToken(req.headers.get('authorization'), 'SYNC_TOKEN')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // ── Products with current stock ──────────────────────────────────────────
    const productSizes = await prisma.productSize.findMany({
      include: {
        product: true,
        stockEntries: {
          include: { session: true },
          orderBy: { session: { periodStart: 'desc' } },
          take: 1,
        },
      },
      orderBy: [{ product: { name: 'asc' } }, { sizeMl: 'asc' }],
    })

    // Get the latest inventory session for stock calculation
    const latestSession = await prisma.inventorySession.findFirst({
      orderBy: { periodStart: 'desc' },
    })

    // Compute current stock for each product size
    const products = await Promise.all(
      productSizes.map(async ps => {
        let stock = 0

        if (latestSession) {
          const [opening, receipts, salesAgg, adjAgg] = await Promise.all([
            prisma.stockEntry.findUnique({
              where: {
                sessionId_productSizeId_entryType: {
                  sessionId: latestSession.id,
                  productSizeId: ps.id,
                  entryType: 'OPENING',
                },
              },
            }),
            prisma.receiptItem.aggregate({
              where: {
                productSizeId: ps.id,
                receipt: { receivedDate: { gte: latestSession.periodStart } },
              },
              _sum: { totalBottles: true },
            }),
            prisma.sale.aggregate({
              where: {
                productSizeId: ps.id,
                saleDate: { gte: latestSession.periodStart },
              },
              _sum: { quantityBottles: true },
            }),
            prisma.stockAdjustment.aggregate({
              where: {
                productSizeId: ps.id,
                approved: true,
                adjustmentDate: { gte: latestSession.periodStart },
              },
              _sum: { quantityBottles: true },
            }),
          ])

          stock = (opening?.totalBottles ?? 0) +
                  (receipts._sum.totalBottles ?? 0) +
                  (adjAgg._sum.quantityBottles ?? 0) -
                  (salesAgg._sum.quantityBottles ?? 0)
        }

        return {
          id: ps.productId,
          item_code: ps.product.itemCode,
          name: `${ps.product.name} ${ps.sizeMl}ml`,
          category: ps.product.category,
          size_id: ps.id,
          size_ml: ps.sizeMl,
          bottles_per_case: ps.bottlesPerCase,
          barcode: ps.barcode ?? null,
          mrp: Number(ps.mrp),
          selling_price: Number(ps.sellingPrice),
          stock: Math.max(0, stock),
        }
      })
    )

    // ── Active staff with face profiles ───────────────────────────────────────
    const staff = await prisma.staff.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        role: true,
        pin: true,
        active: true,
        faceProfile: {
          select: {
            threshold: true,
            sampleCount: true,
            descriptor: true,
            enrolledAt: true,
            lastMatchedAt: true,
            updatedAt: true,
            samples: {
              orderBy: { createdAt: 'asc' },
              select: {
                descriptor: true,
                detectionScore: true,
                qualityScore: true,
              },
            },
          },
        },
      },
    })

    const staffMapped = staff.map(s => ({
      id: s.id,
      name: s.name,
      role: s.role,
      // PINs are authentication credentials — never expose over the wire.
      // The desktop app uses face recognition for attendance, not PINs.
      hasPin: !!s.pin,
      active: s.active ? 1 : 0,
      face_profile_json: s.faceProfile ? JSON.stringify({
        threshold: s.faceProfile.threshold,
        sampleCount: s.faceProfile.sampleCount,
        descriptor: s.faceProfile.descriptor ?? null,
        enrolledAt: s.faceProfile.enrolledAt ? s.faceProfile.enrolledAt.toISOString() : null,
        lastMatchedAt: s.faceProfile.lastMatchedAt ? s.faceProfile.lastMatchedAt.toISOString() : null,
        updatedAt: s.faceProfile.updatedAt.toISOString(),
        samples: s.faceProfile.samples.map(sample => ({
          descriptor: sample.descriptor,
          detectionScore: Number(sample.detectionScore),
          qualityScore: Number(sample.qualityScore),
        })),
      }) : null,
    }))

    // ── Today's cloud cash record (for opening balance reference) ─────────────
    const cashToday = await prisma.cashRecord.findUnique({
      where: { recordDate: today },
    })

    const cashTodayMapped = cashToday ? {
      recordDate: cashToday.recordDate.toISOString().slice(0, 10),
      openingRegister: Number(cashToday.openingRegister),
      cashSales: Number(cashToday.cashSales),
      expenses: Number(cashToday.expenses),
      cashToLocker: Number(cashToday.cashToLocker),
      closingRegister: Number(cashToday.closingRegister),
      cardSales: Number(cashToday.cardSales),
      upiSales: Number(cashToday.upiSales),
      creditSales: Number(cashToday.creditSales),
      creditCollected: Number(cashToday.creditCollected),
    } : null

    return NextResponse.json({
      products,
      staff: staffMapped,
      cash_today: cashTodayMapped,
      synced_at: Date.now(),
    })
  } catch (e) {
    console.error('[sync/pull]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
