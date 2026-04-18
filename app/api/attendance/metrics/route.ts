import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const fromParam = url.searchParams.get('from')
    const toParam = url.searchParams.get('to')

    const fromDate = fromParam ? toUtcNoonDate(new Date(fromParam)) : toUtcNoonDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
    const toDate = toParam ? toUtcNoonDate(new Date(toParam)) : toUtcNoonDate(new Date())

    const staff = await prisma.staff.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        role: true,
        payrollType: true,
        dailyWage: true,
        monthlySalary: true,
      },
    })

    const logs = await prisma.attendanceLog.findMany({
      where: { date: { gte: fromDate, lte: toDate } },
      select: { staffId: true, date: true, checkIn: true, checkOut: true },
    })

    const map = new Map<number, {
      staffId: number
      staffName: string
      role: string
      payrollType: string
      dailyWage: number
      monthlySalary: number
      daysPresent: number
      totalHours: number
      months: Record<string, { daysPresent: number; totalHours: number }>
    }>()
    for (const s of staff) {
      map.set(s.id, {
        staffId: s.id,
        staffName: s.name,
        role: s.role,
        payrollType: s.payrollType,
        dailyWage: Number(s.dailyWage ?? 0),
        monthlySalary: Number(s.monthlySalary ?? 0),
        daysPresent: 0,
        totalHours: 0,
        months: {},
      })
    }

    const todayNoon = toUtcNoonDate(new Date())

    for (const l of logs) {
      const entry = map.get(l.staffId)
      if (!entry) continue

      entry.daysPresent += 1
      const d = new Date(l.date)
      const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`

      let hours = 0
      if (l.checkIn && l.checkOut) {
        hours = (new Date(l.checkOut).getTime() - new Date(l.checkIn).getTime()) / 3_600_000
      } else if (l.checkIn && !l.checkOut) {
        // If it's today, compute running hours
        const logDateNoon = toUtcNoonDate(new Date(l.date))
        if (logDateNoon.getTime() === todayNoon.getTime()) {
          hours = (Date.now() - new Date(l.checkIn).getTime()) / 3_600_000
        }
      }

      entry.totalHours += hours
      if (!entry.months[monthKey]) {
        entry.months[monthKey] = { daysPresent: 0, totalHours: 0 }
      }
      entry.months[monthKey].daysPresent += 1
      entry.months[monthKey].totalHours += hours
    }

    const result = Array.from(map.values()).map(r => ({
      staffId: r.staffId,
      staffName: r.staffName,
      role: r.role,
      payrollType: r.payrollType,
      dailyWage: r.dailyWage,
      monthlySalary: r.monthlySalary,
      daysPresent: r.daysPresent,
      totalHours: Math.round(r.totalHours * 10) / 10,
      avgHours: r.daysPresent > 0 ? Math.round((r.totalHours / r.daysPresent) * 10) / 10 : 0,
      salaryOwed: r.payrollType === 'DAILY' ? Math.round(r.daysPresent * r.dailyWage * 100) / 100 : 0,
      monthly: Object.entries(r.months)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, m]) => ({
          month,
          daysPresent: m.daysPresent,
          totalHours: Math.round(m.totalHours * 10) / 10,
          avgHours: m.daysPresent > 0 ? Math.round((m.totalHours / m.daysPresent) * 10) / 10 : 0,
          salaryOwed: r.payrollType === 'DAILY'
            ? Math.round(m.daysPresent * r.dailyWage * 100) / 100
            : 0,
        })),
    }))

    return NextResponse.json(result.sort((a, b) => a.staffName.localeCompare(b.staffName)))
  } catch (error: any) {
    console.error('[attendance metrics GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
