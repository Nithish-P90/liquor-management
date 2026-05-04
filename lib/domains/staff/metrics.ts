import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/platform/prisma"
import { REVENUE_BILL_WHERE } from "@/lib/domains/billing/bill"

export type StaffMetricsRange = { from: Date; to: Date }

export type StaffMetric = {
  staffId: number
  name: string
  role: string
  billsHandled: number
  totalRevenue: number       // sum of netCollectible on operated bills
  liquorRevenue: number      // ownerTotal sum (liquor lines only)
  miscRevenue: number        // cashierTotal sum (all MISC, including third-party)
  thirdPartyRevenue: number  // thirdPartyTotal sum (subset of miscRevenue owed to supplier)
  ownerNetRevenue: number    // totalRevenue - thirdPartyRevenue
  attendanceDays: number
}

/**
 * Returns revenue and attendance metrics for all active staff.
 * When range is provided, filters bills and attendance to that window.
 */
export async function staffMetrics(range?: StaffMetricsRange): Promise<StaffMetric[]> {
  const billWhere = range
    ? { ...REVENUE_BILL_WHERE, businessDate: { gte: range.from, lte: range.to } }
    : REVENUE_BILL_WHERE

  const attendanceWhere: Prisma.AttendanceLogWhereInput | undefined = range
    ? { checkIn: { gte: range.from, lte: range.to } }
    : undefined

  type StaffMetricsRow = {
    id: number
    name: string
    role: string
    billsOperated: Array<{
      netCollectible: Prisma.Decimal | number | string
      ownerTotal: Prisma.Decimal | number | string
      cashierTotal: Prisma.Decimal | number | string
      thirdPartyTotal: Prisma.Decimal | number | string
    }>
    _count: { attendanceLogs: number }
  }

  const staff = (await prisma.staff.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      role: true,
      billsOperated: {
        where: billWhere,
        select: {
          netCollectible: true,
          ownerTotal: true,
          cashierTotal: true,
          thirdPartyTotal: true,
        },
      },
      _count: {
        select: { attendanceLogs: { where: attendanceWhere } },
      },
    },
    orderBy: { name: "asc" },
  })) as StaffMetricsRow[]

  return staff.map((s) => {
    const totalRevenue = s.billsOperated.reduce((sum, b) => sum + Math.max(0, Number(b.netCollectible)), 0)
    const liquorRevenue = s.billsOperated.reduce((sum, b) => sum + Math.max(0, Number(b.ownerTotal)), 0)
    const miscRevenue = s.billsOperated.reduce((sum, b) => sum + Math.max(0, Number(b.cashierTotal)), 0)
    const thirdPartyRevenue = s.billsOperated.reduce((sum, b) => sum + Math.max(0, Number(b.thirdPartyTotal)), 0)

    return {
      staffId: s.id,
      name: s.name,
      role: s.role,
      billsHandled: s.billsOperated.length,
      totalRevenue,
      liquorRevenue,
      miscRevenue,
      thirdPartyRevenue,
      ownerNetRevenue: totalRevenue - thirdPartyRevenue,
      attendanceDays: s._count.attendanceLogs,
    }
  })
}
