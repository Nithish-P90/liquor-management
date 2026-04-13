import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { Category } from '@prisma/client'

export const dynamic = 'force-dynamic'

// Simple CSV parser that handles quotes and multiple lines
function parseCSV(text: string) {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentCell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentCell.trim())
      currentCell = ''
    } else if (char === '\n' && !inQuotes) {
      currentRow.push(currentCell.trim())
      rows.push(currentRow)
      currentRow = []
      currentCell = ''
    } else {
      currentCell += char
    }
  }
  if (currentRow.length > 0 || currentCell) {
    currentRow.push(currentCell.trim())
    rows.push(currentRow)
  }
  return rows
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

export async function POST(req: NextRequest) {
  try {
    const { csvData } = await req.json()
    if (!csvData) return NextResponse.json({ error: 'No data provided' }, { status: 400 })

    const rows = parseCSV(csvData)
    if (rows.length < 2) return NextResponse.json({ error: 'Empty or invalid CSV' }, { status: 400 })

    const header = rows[0].map(h => h.toLowerCase())
    const dataRows = rows.slice(1)

    const colIndex = {
      itemCode: header.indexOf('itemcode'),
      name: header.indexOf('name'),
      sizeMl: header.indexOf('sizeml'),
      barcode: header.indexOf('barcode'),
      bpc: header.indexOf('bottlespercase'), // Optional
      price: header.indexOf('price'),        // Optional
    }

    if (colIndex.itemCode === -1 || colIndex.sizeMl === -1 || colIndex.barcode === -1) {
      return NextResponse.json({ 
        error: 'CSV must contain headers: itemCode, sizeMl, barcode' 
      }, { status: 400 })
    }

    let updatedCount = 0
    let createdCount = 0

    // Process rows sequentially to avoid database lock issues in this context
    for (const row of dataRows) {
      if (row.length < 3) continue

      const itemCode = row[colIndex.itemCode]
      const sizeMl = parseInt(row[colIndex.sizeMl])
      const barcode = row[colIndex.barcode]
      const name = colIndex.name !== -1 ? row[colIndex.name] : 'Unknown Product'
      const bpc = colIndex.bpc !== -1 ? parseInt(row[colIndex.bpc]) : 12
      const sellingPrice = colIndex.price !== -1 ? parseFloat(row[colIndex.price]) : 0

      if (!itemCode || isNaN(sizeMl) || !barcode) continue

      // Upsert Product
      const product = await prisma.product.upsert({
        where: { itemCode },
        update: {},
        create: {
          itemCode,
          name: name || 'Unknown Product',
          category: inferCategory(name),
        }
      })

      // Upsert ProductSize with Barcode
      const productSize = await prisma.productSize.upsert({
        where: {
          productId_sizeMl: {
            productId: product.id,
            sizeMl,
          }
        },
        update: {
          barcode,
          ...(sellingPrice > 0 ? { sellingPrice, mrp: sellingPrice } : {}),
          ...(bpc > 0 ? { bottlesPerCase: bpc } : {})
        },
        create: {
          productId: product.id,
          sizeMl,
          barcode,
          bottlesPerCase: bpc || 12,
          mrp: sellingPrice || 0,
          sellingPrice: sellingPrice || 0,
        }
      })

      if (productSize.createdAt > new Date(Date.now() - 5000)) {
        createdCount++
      } else {
        updatedCount++
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: `Import complete: ${createdCount} new products/sizes created, ${updatedCount} barcodes updated.` 
    })
  } catch (error) {
    console.error('Bulk import failed', error)
    return NextResponse.json({ error: 'Failed to process bulk import' }, { status: 500 })
  }
}
