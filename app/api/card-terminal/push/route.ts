import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'

/**
 * POST /api/card-terminal/push
 * Stub for HDFC / BonusHub Verifone X990 ECR integration.
 * Returns simulated success until real terminal integration is implemented.
 */
export async function POST(req: Request) {
  // Card terminal push requires an authenticated session
  const [, authErr] = await requireSession()
  if (authErr) return authErr

  try {
    const { amount } = await req.json()

    const parsedAmount = Number(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json({ error: 'Valid amount required' }, { status: 400 })
    }

    // Stub: simulate terminal handshake delay
    await new Promise(r => setTimeout(r, 1500))

    return NextResponse.json({ success: true, message: 'Terminal transaction successful' })
  } catch {
    return NextResponse.json({ error: 'Terminal push failed' }, { status: 500 })
  }
}
