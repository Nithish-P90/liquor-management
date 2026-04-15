import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { toUtcNoonDate } from '@/lib/date-utils'
import { findBestFaceMatch, toFaceDescriptor } from '@/lib/face-matching'

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
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const requestedStaffId = Number(body?.staffId)
    const allowManualOverride = body?.allowManualOverride === true
    const faceDescriptor = toFaceDescriptor(body?.faceDescriptor ?? body?.descriptor)

    if (!faceDescriptor && !allowManualOverride) {
      return NextResponse.json({ error: 'Face descriptor required for attendance.' }, { status: 400 })
    }

    let resolvedStaffId: number | null = null
    let resolvedStaffName = ''
    let matchMeta: { distance: number; confidence: number; threshold: number; sampleCount: number } | null = null

    if (faceDescriptor) {
      const faceProfiles = await loadActiveFaceProfiles()
      const matchOutcome = findBestFaceMatch(faceDescriptor, faceProfiles, { defaultThreshold: 0.48, margin: 0.05 })

      if (!matchOutcome.match) {
        return NextResponse.json(
          { error: matchOutcome.reason ?? 'Face match failed. Try again with a clearer frame.' },
          { status: 422 }
        )
      }

      if (Number.isInteger(requestedStaffId) && requestedStaffId > 0 && requestedStaffId !== matchOutcome.match.staffId) {
        return NextResponse.json(
          { error: 'Recognized face does not match the selected staff member.' },
          { status: 409 }
        )
      }

      resolvedStaffId = matchOutcome.match.staffId
      resolvedStaffName = matchOutcome.match.staffName
      matchMeta = {
        distance: matchOutcome.match.distance,
        confidence: matchOutcome.match.confidence,
        threshold: matchOutcome.match.threshold,
        sampleCount: matchOutcome.match.sampleCount,
      }
    } else if (allowManualOverride && Number.isInteger(requestedStaffId) && requestedStaffId > 0) {
      const staff = await prisma.staff.findFirst({ where: { id: requestedStaffId, active: true } })
      if (!staff) {
        return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
      }
      resolvedStaffId = staff.id
      resolvedStaffName = staff.name
    }

    if (!resolvedStaffId) {
      return NextResponse.json({ error: 'Unable to resolve staff for attendance.' }, { status: 400 })
    }

    const staff = await prisma.staff.findFirst({ where: { id: resolvedStaffId, active: true } })
    if (!staff) {
      return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
    }

    return markAttendance(staff.id, resolvedStaffName || staff.name, matchMeta)
  } catch (error: any) {
    console.error('[attendance POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// ── Shared: upsert attendance log ──────────────────────────────────────────────
async function markAttendance(
  staffId: number,
  staffName: string,
  matchMeta?: { distance: number; confidence: number; threshold: number; sampleCount: number } | null
) {
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
    return NextResponse.json({ success: true, staff: staffName, type: 'CHECK_IN', time: now, faceMatch: matchMeta })
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
      faceMatch: matchMeta,
    })
  }

  // Already checked in and out (2/2) — block further scans for today
  return NextResponse.json(
    { error: `${staffName} has already completed their 2 scans for today.` },
    { status: 400 }
  )
}

async function loadActiveFaceProfiles() {
  const staff = await prisma.staff.findMany({
    where: {
      active: true,
      faceProfile: { isNot: null },
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      role: true,
      faceProfile: {
        select: {
          threshold: true,
          sampleCount: true,
          descriptor: true,
          samples: {
            orderBy: { createdAt: 'asc' },
            select: {
              descriptor: true,
            },
          },
        },
      },
    },
  })

  return staff.flatMap(staffMember => {
    const profile = staffMember.faceProfile
    if (!profile) return []

    return [{
      staffId: staffMember.id,
      staffName: staffMember.name,
      role: staffMember.role,
      threshold: profile.threshold,
      sampleCount: profile.sampleCount,
      descriptor: toFaceDescriptor(profile.descriptor),
      samples: profile.samples
        .map(sample => {
          const descriptor = toFaceDescriptor(sample.descriptor)
          return descriptor ? { descriptor } : null
        })
        .filter((sample): sample is { descriptor: number[] } => Boolean(sample)),
    }]
  })
}
