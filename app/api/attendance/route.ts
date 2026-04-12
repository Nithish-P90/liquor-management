import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function POST(req: Request) {
  try {
    const { template } = await req.json()
    if (!template) return NextResponse.json({ error: 'Missing fingerprint' }, { status: 400 })

    // Simulate Biometric Extraction and 1:N Matching Sequence 
    // (In production, the backend SDK or an external AFIS would process the ISO template)
    
    // For this simulation, we'll find the staff member who matches the template exactly (or fallback to staff #1 if mock).
    // The MFS100 returns XML with PID data.
    const staffMember = await prisma.staff.findFirst({
      where: { fingerprintTemplate: template }
    })

    if (!staffMember) {
      return NextResponse.json({ error: 'Fingerprint not recognized. Staff member not found.' }, { status: 404 })
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Log Attendance
    const log = await prisma.attendanceLog.upsert({
      where: { staffId_date: { staffId: staffMember.id, date: today } },
      update: { checkOut: new Date() }, // If already checked in, marking checkout
      create: {
        staffId: staffMember.id,
        date: today,
        checkIn: new Date()
      }
    })

    return NextResponse.json({ success: true, staff: staffMember.name, type: log.checkOut ? 'CHECK OUT' : 'CHECK IN' })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
