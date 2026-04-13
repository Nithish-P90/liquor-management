import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const staff = await prisma.staff.findMany({
    select: { id: true, name: true, email: true, role: true, active: true, pin: true, createdAt: true, fingerprintTemplate: true, payrollType: true, monthlySalary: true, dailyWage: true },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(staff)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<{
      name: string; email?: string | null; pin?: string | null; role?: string;
      payrollType?: string; monthlySalary?: number; dailyWage?: number
    }>
    const { name, email, pin, role, payrollType, monthlySalary, dailyWage } = body

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

    const data: Record<string, unknown> = { name, email: email || null, role }
    if (role === 'CASHIER') data.pin = pin
    if (payrollType) data.payrollType = payrollType
    if (monthlySalary !== undefined) data.monthlySalary = monthlySalary
    if (dailyWage !== undefined) data.dailyWage = dailyWage

    const staff = await prisma.staff.create({
      data,
      select: { id: true, name: true, email: true, role: true, active: true, pin: true, payrollType: true, monthlySalary: true, dailyWage: true },
    })
    return NextResponse.json(staff)
  } catch (error) {
    console.error('Failed to add staff', error)
    return NextResponse.json({ error: 'Failed to create staff account' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as Partial<{
    id?: number; active?: boolean; pin?: string | null; name?: string; role?: string;
    payrollType?: string; monthlySalary?: number; dailyWage?: number
  }>
  const { id, active, pin, name, role, payrollType, monthlySalary, dailyWage } = body

  const existingStaff = await prisma.staff.findUnique({ where: { id } })
  if (!existingStaff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })

  const updateData: Record<string, unknown> = {
    ...(active !== undefined && { active }),
    ...(name && { name }),
    ...(role && { role }),
    ...(payrollType && { payrollType }),
    ...(monthlySalary !== undefined && { monthlySalary }),
    ...(dailyWage !== undefined && { dailyWage }),
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
    select: { id: true, name: true, email: true, role: true, active: true, pin: true, payrollType: true, monthlySalary: true, dailyWage: true },
  })
  return NextResponse.json(staff)
}
