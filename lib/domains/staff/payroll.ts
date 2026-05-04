import { attendanceMetrics, AttendanceMetrics } from "@/lib/domains/attendance/metrics"

export type PayrollEntry = {
  staffId: number
  name: string
  role: string
  payrollType: string
  month: string
  workingDaysInMonth: number
  daysPresent: number
  daysAbsent: number
  lateArrivals: number
  earlyDepartures: number
  grossSalary: number | null      // configured monthly salary or dailyWage × workingDaysInMonth
  earnedAmount: number | null     // prorated: grossSalary × (daysPresent / workingDaysInMonth)
  deductionDays: number           // absent days that reduce pay
  deductionAmount: number | null  // deductionDays × dailyRate
  netPayable: number | null
}

function calcPayroll(m: AttendanceMetrics): PayrollEntry {
  const base: Omit<PayrollEntry, "grossSalary" | "earnedAmount" | "deductionDays" | "deductionAmount" | "netPayable"> = {
    staffId: m.staffId,
    name: m.name,
    role: m.role,
    payrollType: m.payrollType,
    month: m.month,
    workingDaysInMonth: m.workingDaysInMonth,
    daysPresent: m.daysPresent,
    daysAbsent: m.daysAbsent,
    lateArrivals: m.lateArrivals,
    earlyDepartures: m.earlyDepartures,
  }

  if (m.payrollType === "SALARY" && m.monthlySalary !== null) {
    const grossSalary = m.monthlySalary
    const dailyRate = m.workingDaysInMonth > 0 ? grossSalary / m.workingDaysInMonth : 0
    const deductionDays = m.daysAbsent
    const deductionAmount = deductionDays * dailyRate
    const earnedAmount = grossSalary - deductionAmount
    return { ...base, grossSalary, earnedAmount, deductionDays, deductionAmount, netPayable: earnedAmount }
  }

  if (m.payrollType === "DAILY" && m.dailyWage !== null) {
    const dailyRate = m.dailyWage
    const earnedAmount = m.daysPresent * dailyRate
    const grossSalary = m.workingDaysInMonth * dailyRate
    return { ...base, grossSalary, earnedAmount, deductionDays: m.daysAbsent, deductionAmount: m.daysAbsent * dailyRate, netPayable: earnedAmount }
  }

  return { ...base, grossSalary: null, earnedAmount: null, deductionDays: 0, deductionAmount: null, netPayable: null }
}

export async function payrollReport(opts: {
  month: string   // "YYYY-MM"
  staffId?: number
}): Promise<PayrollEntry[]> {
  const metrics = await attendanceMetrics(opts)
  return metrics.map(calcPayroll)
}
