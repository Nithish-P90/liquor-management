import { NextRequest, NextResponse } from 'next/server'
import { runReconciliation } from '@/lib/reconciliation'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { date, sessionId } = body
  const results = await runReconciliation(new Date(date), sessionId)
  return NextResponse.json({ results, count: results.length })
}
