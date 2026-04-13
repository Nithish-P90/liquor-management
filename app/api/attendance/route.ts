import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import {
  extractTemplateFromXml,
  normaliseAllTemplates,
  matchAgainstStored,
} from '@/lib/fingerprint-matcher'
import { toUtcNoonDate } from '@/lib/date-utils'

export const dynamic = 'force-dynamic'

// ── GET /api/attendance?date=YYYY-MM-DD ────────────────────────────────────────
// Returns all active staff with their attendance status for the given date.
// Defaults to today if no date param.
export async function GET(req: NextRequest) {
  try {
    const url    = new URL(req.url)
    const dateParam = url.searchParams.get('date')
    const targetDate = dateParam
      ? toUtcNoonDate(new Date(dateParam))
      : toUtcNoonDate(new Date())

    const allStaff = await prisma.staff.findMany({
      where:   { active: true },
      orderBy: { name: 'asc' },
      select:  { id: true, name: true, role: true },
    })

    const logs = await prisma.attendanceLog.findMany({
      where: { date: targetDate },
    })

    const logMap = new Map<number, typeof logs[0]>(logs.map((l: any) => [l.staffId, l] as [number, typeof logs[0]]))
    const result = allStaff.map((s: any) => {
      const log = logMap.get(s.id)
      let hoursWorked: number | null = null

      if (log?.checkIn && log?.checkOut) {
        hoursWorked =
          (new Date(log.checkOut).getTime() - new Date(log.checkIn).getTime()) / 3_600_000
      } else if (log?.checkIn) {
        // Still clocked in — compute running duration
        hoursWorked =
          (Date.now() - new Date(log.checkIn).getTime()) / 3_600_000
      }

      const scanCount =
        !log            ? 0
        : !log.checkOut ? 1
        : 2

      const status =
        scanCount === 0 ? 'ABSENT'
        : scanCount === 1 ? 'IN'
        : 'OUT'

      return {
        staffId:     s.id,
        staffName:   s.name,
        role:        s.role,
        checkIn:     log?.checkIn  ?? null,
        checkOut:    log?.checkOut ?? null,
        hoursWorked: hoursWorked !== null ? Math.round(hoursWorked * 10) / 10 : null,
        status,
        scanCount, // New data for UI progress bars
      }
    })

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('[attendance GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// ── POST /api/attendance ───────────────────────────────────────────────────────
// Accepts either:
//   { template: "<PidData>...</PidData>" }  — raw Mantra RD XML (auto-extracted)
//   { template: "Rk1SAC..."              }  — already-extracted base64
//   { staffId: 1, pin: "1234"           }  — PIN-based fallback
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // ── PIN fallback ───────────────────────────────────────────────────────────
    if (body.staffId && body.pin) {
      const staff = await prisma.staff.findFirst({
        where: { id: body.staffId, pin: body.pin, active: true },
      })
      if (!staff) {
        return NextResponse.json({ error: 'Invalid PIN or staff not found.' }, { status: 401 })
      }
      return markAttendance(staff.id, staff.name)
    }

    // ── Fingerprint path ───────────────────────────────────────────────────────
    const rawTemplate: string = body.template
    if (!rawTemplate) {
      return NextResponse.json({ error: 'Missing template or pin.' }, { status: 400 })
    }

    // Extract base64 from XML if needed
    const probeBase64 =
      rawTemplate.trimStart().startsWith('<')
        ? extractTemplateFromXml(rawTemplate)
        : rawTemplate

    if (!probeBase64) {
      return NextResponse.json(
        { error: 'Could not extract fingerprint template from sensor response.' },
        { status: 400 }
      )
    }

    // Load all staff who have a fingerprint enrolled
    const staffWithFp = await prisma.staff.findMany({
      where:  { fingerprintTemplate: { not: null }, active: true },
      select: { id: true, name: true, fingerprintTemplate: true },
    })

    if (staffWithFp.length === 0) {
      return NextResponse.json(
        { error: 'No fingerprints enrolled yet. Enroll staff first.' },
        { status: 404 }
      )
    }

    // 1:N match — compare against every enrolled staff member
    let bestStaffId   = -1
    let bestStaffName = ''
    let bestScore     = 0

    for (const s of staffWithFp) {
      const storedTemplates = normaliseAllTemplates(s.fingerprintTemplate!)
      const result = matchAgainstStored(probeBase64, storedTemplates)

      if (result.score > bestScore) {
        bestScore     = result.score
        bestStaffId   = s.id
        bestStaffName = s.name
      }
    }

    const MATCH_THRESHOLD = 0.40
    if (bestScore < MATCH_THRESHOLD) {
      return NextResponse.json(
        { error: 'Fingerprint not recognised. Please try again or use PIN.' },
        { status: 404 }
      )
    }

    return markAttendance(bestStaffId, bestStaffName)
  } catch (error: any) {
    console.error('[attendance POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// ── Shared: upsert attendance log ──────────────────────────────────────────────
async function markAttendance(staffId: number, staffName: string) {
  const now   = new Date()
  const today = toUtcNoonDate(now)

  const existing = await prisma.attendanceLog.findUnique({
    where: { staffId_date: { staffId, date: today } },
  })

  if (!existing) {
    // First scan of the day → check in
    await prisma.attendanceLog.create({
      data: { staffId, date: today, checkIn: now, status: 'PRESENT' },
    })
    return NextResponse.json({ success: true, staff: staffName, type: 'CHECK_IN', time: now })
  }

  if (!existing.checkOut) {
    // Already checked in, not yet checked out → check out
    await prisma.attendanceLog.update({
      where: { staffId_date: { staffId, date: today } },
      data:  { checkOut: now },
    })
    const hours =
      (now.getTime() - new Date(existing.checkIn).getTime()) / 3_600_000
    return NextResponse.json({
      success: true,
      staff:  staffName,
      type:   'CHECK_OUT',
      time:   now,
      scanCount: 2,
      hoursWorked: Math.round(hours * 10) / 10,
    })
  }

  // Already checked in and out (2/2) — block further scans for today
  return NextResponse.json(
    { error: `${staffName} has already completed their 2 scans for today.` },
    { status: 400 }
  )
}
