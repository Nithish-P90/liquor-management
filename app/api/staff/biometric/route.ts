import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function POST(req: Request) {
  try {
    const { staffId, template } = await req.json()
    if (!staffId || !template) return NextResponse.json({ error: 'Missing data' }, { status: 400 })

    await prisma.staff.update({
      where: { id: staffId },
      data: { fingerprintTemplate: template }
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
