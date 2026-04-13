import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const fromParam = url.searchParams.get('from')
    const toParam = url.searchParams.get('to')

    const fromDate = fromParam ? toUtcNoonDate(new Date(fromParam)) : toUtcNoonDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
    const toDate = toParam ? toUtcNoonDate(new Date(toParam)) : toUtcNoonDate(new Date())

    const staff = await prisma.staff.findMany({
      where: { active: true },
      select: { id: true, name: true, role: true },
    })

    const logs = await prisma.attendanceLog.findMany({
      where: { date: { gte: fromDate, lte: toDate } },
      select: { staffId: true, date: true, checkIn: true, checkOut: true },
    })

    const map = new Map<number, { staffId: number; staffName: string; role: string; daysPresent: number; totalHours: number }>()
    for (const s of staff) {
      map.set(s.id, { staffId: s.id, staffName: s.name, role: s.role, daysPresent: 0, totalHours: 0 })
    }

    const todayNoon = toUtcNoonDate(new Date())

    for (const l of logs) {
      const entry = map.get(l.staffId)
      if (!entry) continue

      entry.daysPresent += 1

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
    }

    const result = Array.from(map.values()).map(r => ({
      staffId: r.staffId,
      staffName: r.staffName,
      role: r.role,
      daysPresent: r.daysPresent,
      totalHours: Math.round(r.totalHours * 10) / 10,
      avgHours: r.daysPresent > 0 ? Math.round((r.totalHours / r.daysPresent) * 10) / 10 : 0,
    }))

    return NextResponse.json(result.sort((a, b) => a.staffName.localeCompare(b.staffName)))
  } catch (error: any) {
    console.error('[attendance metrics GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
