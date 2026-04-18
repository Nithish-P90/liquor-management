import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireSession, requireAdmin } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [session, err] = await requireSession()
  if (err) return err

  const isAdmin = session.user.role === 'ADMIN'

  const staff = await prisma.staff.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      // Only expose PIN existence to admins, never the actual value
      pin: isAdmin,
      createdAt: true,
      payrollType: true,
      monthlySalary: true,
      dailyWage: true,
      expectedCheckIn: true,
      expectedCheckOut: true,
      lateGraceMinutes: true,
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
    orderBy: { name: 'asc' },
  })

  // For admin: mask PINs to indicate presence only (e.g. "****")
  const mapped = isAdmin
    ? staff.map(s => ({ ...s, hasPin: !!s.pin, pin: s.pin ? '****' : null }))
    : staff

  return NextResponse.json(mapped)
}

export async function POST(req: NextRequest) {
  const [, authErr] = await requireAdmin()
  if (authErr) return authErr

  try {
    const body = await req.json() as Partial<{
      name: string; email?: string | null; pin?: string | null; role?: string;
      payrollType?: string; monthlySalary?: number; dailyWage?: number;
      expectedCheckIn?: string | null; expectedCheckOut?: string | null; lateGraceMinutes?: number;
    }>
    const { name, email, pin, role, payrollType, monthlySalary, dailyWage,
            expectedCheckIn, expectedCheckOut, lateGraceMinutes } = body

    // Enforce PIN only for cashiers
    if (role === 'CASHIER') {
      if (!pin) {
        return NextResponse.json({ error: 'Cashiers require a 4-digit PIN' }, { status: 400 })
      }
      if (!/^\d{4}$/.test(pin)) {
        return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 })
      }
      const existing = await prisma.staff.findUnique({ where: { pin } })
      if (existing) {
        return NextResponse.json({ error: 'PIN is already assigned to another staff member' }, { status: 400 })
      }
    }

    // Default schedule for CASHIER and SUPPLIER: 10:00 in, 22:30 out
    const defaultsSchedule = (role === 'CASHIER' || role === 'SUPPLIER')
    const data: Record<string, unknown> = { name, email: email || null, role }
    if (role === 'CASHIER') data.pin = pin
    if (payrollType) data.payrollType = payrollType
    if (monthlySalary !== undefined) data.monthlySalary = monthlySalary
    if (dailyWage !== undefined) data.dailyWage = dailyWage
    data.expectedCheckIn  = expectedCheckIn  !== undefined ? (expectedCheckIn  || null) : (defaultsSchedule ? '10:00' : null)
    data.expectedCheckOut = expectedCheckOut !== undefined ? (expectedCheckOut || null) : (defaultsSchedule ? '22:30' : null)
    if (lateGraceMinutes !== undefined) data.lateGraceMinutes = lateGraceMinutes

    const staff = await prisma.staff.create({
      data,
      select: { id: true, name: true, email: true, role: true, active: true, pin: true,
                payrollType: true, monthlySalary: true, dailyWage: true,
                expectedCheckIn: true, expectedCheckOut: true, lateGraceMinutes: true },
    })
    return NextResponse.json(staff)
  } catch (error) {
    console.error('Failed to add staff', error)
    return NextResponse.json({ error: 'Failed to create staff account' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const [, authErr] = await requireAdmin()
  if (authErr) return authErr

  const body = await req.json() as Partial<{
    id?: number; active?: boolean; pin?: string | null; name?: string; role?: string;
    payrollType?: string; monthlySalary?: number; dailyWage?: number;
    expectedCheckIn?: string | null; expectedCheckOut?: string | null; lateGraceMinutes?: number;
  }>
  const { id, active, pin, name, role, payrollType, monthlySalary, dailyWage,
          expectedCheckIn, expectedCheckOut, lateGraceMinutes } = body

  const existingStaff = await prisma.staff.findUnique({ where: { id } })
  if (!existingStaff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })

  const updateData: Record<string, unknown> = {
    ...(active !== undefined && { active }),
    ...(name && { name }),
    ...(role && { role }),
    ...(payrollType && { payrollType }),
    ...(monthlySalary !== undefined && { monthlySalary }),
    ...(dailyWage !== undefined && { dailyWage }),
    ...(expectedCheckIn  !== undefined && { expectedCheckIn:  expectedCheckIn  || null }),
    ...(expectedCheckOut !== undefined && { expectedCheckOut: expectedCheckOut || null }),
    ...(lateGraceMinutes !== undefined && { lateGraceMinutes }),
  }

  // If role is changed away from CASHIER, clear the PIN
  if (role && role !== 'CASHIER') {
    updateData.pin = null
  } else {
    // If PIN provided, validate and set (only allowed for CASHIER)
    const allowPin = (role ? role === 'CASHIER' : existingStaff.role === 'CASHIER')
    if (pin !== undefined && pin !== null && pin !== '') {
      if (!allowPin) return NextResponse.json({ error: 'Only cashiers can have a PIN' }, { status: 400 })
      if (!/^\d{4}$/.test(pin)) return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 })
      const found = await prisma.staff.findUnique({ where: { pin } })
      if (found && found.id !== id) return NextResponse.json({ error: 'PIN already in use' }, { status: 400 })
      updateData.pin = pin
    }
  }

  const staff = await prisma.staff.update({
    where: { id },
    data: updateData,
    select: { id: true, name: true, email: true, role: true, active: true, pin: true,
              payrollType: true, monthlySalary: true, dailyWage: true,
              expectedCheckIn: true, expectedCheckOut: true, lateGraceMinutes: true },
  })
  return NextResponse.json(staff)
}
