import { NextRequest, NextResponse } from 'next/server'
import { generateStockSheet } from '@/lib/excel-export'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const sessionId = parseInt(searchParams.get('sessionId') ?? '0')
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const buffer = await generateStockSheet(sessionId)
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="MV-Stock-Sheet.xlsx"`,
    },
  })
}
