import { NextRequest, NextResponse } from 'next/server'
import { parseIndentPdf } from '@/lib/pdf-parser'
import prisma from '@/lib/prisma'
import { Category } from '@prisma/client'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'

function safeNumber(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

function inferCategory(itemName: string): Category {
  const name = itemName.toUpperCase()
  if (name.includes('BEER') || name.includes('LAGER')) return Category.BEER
  if (name.includes('BRANDY')) return Category.BRANDY
  if (name.includes('WHISKY') || name.includes('WHISKEY')) return Category.WHISKY
  if (name.includes('RUM')) return Category.RUM
  if (name.includes('VODKA')) return Category.VODKA
  if (name.includes('GIN')) return Category.GIN
  if (name.includes('WINE')) return Category.WINE
  if (name.includes('BREEZER') || name.includes('PREMIX')) return Category.PREMIX
  return Category.WHISKY
}

function bottlePrice(item: {
  ratePerCase: number
  indentAmount: number
  indentCases: number
  indentBottles: number
  cnfAmount: number
  cnfCases: number
  cnfBottles: number
  bottlesPerCase: number
}) {
  const bottlesPerCase = Math.max(1, safeNumber(item.bottlesPerCase, 12))
  const ratePrice = safeNumber(item.ratePerCase) / bottlesPerCase
  if (ratePrice > 0) return ratePrice

  const cnfBottles = (safeNumber(item.cnfCases) * bottlesPerCase) + safeNumber(item.cnfBottles)
  const cnfPrice = cnfBottles > 0 ? safeNumber(item.cnfAmount) / cnfBottles : 0
  if (cnfPrice > 0) return cnfPrice

  const indentBottles = (safeNumber(item.indentCases) * bottlesPerCase) + safeNumber(item.indentBottles)
  const indentPrice = indentBottles > 0 ? safeNumber(item.indentAmount) / indentBottles : 0
  return safeNumber(indentPrice)
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL
    let pdfPath = ''

    if (isVercel) {
      // On Vercel, we can't write to the filesystem. Use a Data URL as the "path".
      // This will be stored in the DB and rendered in the frontend iframe.
      const base64 = buffer.toString('base64')
      pdfPath = `data:application/pdf;base64,${base64}`
    } else {
      // Local development: use the filesystem
      const uploadsDir = path.join(process.cwd(), 'uploads', 'indents')
      await mkdir(uploadsDir, { recursive: true })
      const filename = `${Date.now()}-${file.name.replace(/[^\w.\- ]/g, '_')}`
      await writeFile(path.join(uploadsDir, filename), buffer)
      pdfPath = `uploads/indents/${filename}`
    }

    const parsed = await parseIndentPdf(buffer)

    if (!parsed.items.length || parsed.header.indentNumber === 'UNKNOWN') {
      return NextResponse.json({
        error: 'Could not read this indent PDF. Please verify it is a KSBCL indent PDF and try again.',
        ocrText: parsed.rawText ?? ''
      }, { status: 422 })
    }

    const existing = await prisma.indent.findUnique({
      where: { indentNumber: parsed.header.indentNumber },
    })
    if (existing) {
      return NextResponse.json({ error: `Indent ${parsed.header.indentNumber} already uploaded` }, { status: 409 })
    }

    const enrichedItems = []

    for (const item of parsed.items) {
      const bottlesPerCase = Math.max(1, safeNumber(item.bottlesPerCase, 12))
      const unitPrice = bottlePrice(item)

      const product = await prisma.product.upsert({
        where: { itemCode: item.itemCode },
        update: {
          name: item.itemName,
        },
        create: {
          itemCode: item.itemCode,
          name: item.itemName,
          category: inferCategory(item.itemName),
        },
        include: { sizes: true },
      })

      let productSize = product.sizes.find(size => size.sizeMl === item.sizeMl)

      if (!productSize) {
        productSize = await prisma.productSize.create({
          data: {
            productId: product.id,
            sizeMl: item.sizeMl,
            bottlesPerCase,
            mrp: unitPrice,
            sellingPrice: unitPrice,
          },
        })
      }

      enrichedItems.push({
        ...item,
        ratePerCase: safeNumber(item.ratePerCase),
        indentCases: safeNumber(item.indentCases),
        indentBottles: safeNumber(item.indentBottles),
        indentAmount: safeNumber(item.indentAmount),
        cnfCases: safeNumber(item.cnfCases),
        cnfBottles: safeNumber(item.cnfBottles),
        cnfAmount: safeNumber(item.cnfAmount),
        bottlesPerCase,
        productId: product.id,
        productSizeId: productSize.id,
      })
    }

    const totals = {
      indentCases: enrichedItems.reduce((sum, item) => sum + item.indentCases, 0),
      indentBottles: enrichedItems.reduce((sum, item) => sum + item.indentBottles, 0),
      indentAmount: enrichedItems.reduce((sum, item) => sum + item.indentAmount, 0),
      cnfCases: enrichedItems.reduce((sum, item) => sum + item.cnfCases, 0),
      cnfBottles: enrichedItems.reduce((sum, item) => sum + item.cnfBottles, 0),
      cnfAmount: enrichedItems.reduce((sum, item) => sum + item.cnfAmount, 0),
    }

    return NextResponse.json({
      parsed: { header: parsed.header, items: enrichedItems, totals },
      pdfPath,
      ocrText: parsed.rawText ?? ''
    })
  } catch (error) {
    console.error('Indent upload failed', error)
    const message = error instanceof Error ? error.message : 'Upload failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
