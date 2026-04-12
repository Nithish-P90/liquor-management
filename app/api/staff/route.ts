import { NextRequest, NextResponse } from 'next/server'
import { hash } from 'bcryptjs'
import prisma from '@/lib/prisma'

export async function GET() {
  const staff = await prisma.staff.findMany({
    select: { id: true, name: true, email: true, role: true, active: true, pin: true, createdAt: true },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(staff)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, email, password, pin, role } = body
  const passwordHash = await hash(password, 10)
  const staff = await prisma.staff.create({
    data: { name, email, passwordHash, pin, role },
    select: { id: true, name: true, email: true, role: true, active: true, pin: true },
  })
  return NextResponse.json(staff)
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, active, pin, name } = body
  const staff = await prisma.staff.update({
    where: { id },
    data: { ...(active !== undefined && { active }), ...(pin && { pin }), ...(name && { name }) },
    select: { id: true, name: true, email: true, role: true, active: true, pin: true },
  })
  return NextResponse.json(staff)
}
