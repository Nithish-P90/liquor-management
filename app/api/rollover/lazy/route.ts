export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { ensureDailyRollover } from '@/lib/rollover'

export async function POST() {
  try {
    const result = await ensureDailyRollover()
    return NextResponse.json(result)

  } catch (error: any) {
    console.error("[Lazy Rollover Error]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
