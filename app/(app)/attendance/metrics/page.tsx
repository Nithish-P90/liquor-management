"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { PageShell } from "@/components/PageShell"
import { ChevronLeft, ChevronRight, Clock, AlertTriangle, TrendingUp, DollarSign, Calendar, Camera, ShieldAlert } from "lucide-react"

type LateIncident = { date: string; shiftStart: string; arrivedAt: string; minutesLate: number }
type EarlyExitIncident = { date: string; shiftEnd: string; leftAt: string; minutesEarly: number }

type AttendanceMetric = {
  staffId: number
  name: string
  role: string
  payrollType: string
  monthlySalary: number | null
  dailyWage: number | null
  month: string
  workingDaysInMonth: number
  daysPresent: number
  daysAbsent: number
  lateArrivals: number
  earlyDepartures: number
  totalMinutesWorked: number
  avgDailyMinutes: number
  weekendDaysInMonth: number
  weekendDaysPresent: number
  weekendDaysMissed: number
  weekendMissedDates: string[]
  lateIncidents: LateIncident[]
  earlyExitIncidents: EarlyExitIncident[]
}

type PayrollEntry = {
  staffId: number
  grossSalary: number | null
  earnedAmount: number | null
  deductionDays: number
  deductionAmount: number | null
  netPayable: number | null
}

function formatMins(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-")
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("default", { month: "long", year: "numeric" })
}

function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function currentYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", weekday: "short" })
}

export default function AttendanceMetricsPage(): JSX.Element {
  const [month, setMonth] = useState(currentYearMonth)
  const [metrics, setMetrics] = useState<AttendanceMetric[]>([])
  const [payroll, setPayroll] = useState<Map<number, PayrollEntry>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  useEffect(() => { loadData(month) }, [month])

  async function loadData(m: string): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const [attRes, payRes] = await Promise.all([
        fetch(`/api/attendance/metrics?month=${m}`),
        fetch(`/api/staff/payroll?month=${m}`),
      ])
      if (!attRes.ok) throw new Error("Failed to load attendance data")
      setMetrics(await attRes.json())
      if (payRes.ok) {
        const payData: PayrollEntry[] = await payRes.json()
        setPayroll(new Map(payData.map((p) => [p.staffId, p])))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error loading data")
    } finally {
      setLoading(false)
    }
  }

  const isCurrentMonth = month === currentYearMonth()
  const totalPresent = metrics.reduce((s, m) => s + m.daysPresent, 0)
  const totalLate = metrics.reduce((s, m) => s + m.lateArrivals, 0)
  const totalWeekendMissed = metrics.reduce((s, m) => s + m.weekendDaysMissed, 0)
  const totalPayroll = Array.from(payroll.values()).reduce((s, p) => s + (p.netPayable ?? 0), 0)
  const staffWithViolations = metrics.filter((m) => m.weekendDaysMissed > 0).length

  return (
    <PageShell title="Attendance Metrics" subtitle="Monthly attendance, punctuality, weekend policy, and payroll.">
      {/* Month Navigator */}
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => setMonth(prevMonth(month))}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 shadow-sm"
        >
          <ChevronLeft size={16} /> Prev
        </button>
        <div className="text-center">
          <h2 className="text-2xl font-black text-slate-900">{monthLabel(month)}</h2>
          {isCurrentMonth && <p className="text-xs text-indigo-600 font-semibold mt-0.5">Current month (partial data)</p>}
        </div>
        <button
          onClick={() => setMonth(nextMonth(month))}
          disabled={isCurrentMonth}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next <ChevronRight size={16} />
        </button>
      </div>

      {error && <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}

      {!loading && metrics.length > 0 && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <SummaryCard icon={<Calendar size={18} />} label="Total Attendance" value={`${totalPresent} days`} color="indigo" />
            <SummaryCard icon={<Clock size={18} />} label="Late Arrivals" value={String(totalLate)} color={totalLate > 0 ? "amber" : "emerald"} />
            <SummaryCard
              icon={<ShieldAlert size={18} />}
              label="Weekend Violations"
              value={totalWeekendMissed > 0 ? `${totalWeekendMissed} (${staffWithViolations} staff)` : "None"}
              color={totalWeekendMissed > 0 ? "rose" : "emerald"}
              badge={totalWeekendMissed > 0 ? "Policy breach" : undefined}
            />
            <SummaryCard icon={<DollarSign size={18} />} label="Total Payroll" value={totalPayroll > 0 ? `₹${totalPayroll.toLocaleString()}` : "—"} color="emerald" />
          </div>

          {/* Staff Rows */}
          <div className="space-y-3">
            {metrics.map((m) => {
              const pay = payroll.get(m.staffId)
              const expanded = expandedId === m.staffId
              const attendancePct = m.workingDaysInMonth > 0 ? Math.round((m.daysPresent / m.workingDaysInMonth) * 100) : 0
              const weekendOk = m.weekendDaysMissed === 0

              return (
                <div key={m.staffId} className={`rounded-2xl border bg-white shadow-sm overflow-hidden ${m.weekendDaysMissed > 0 ? "border-rose-200" : "border-slate-200"}`}>
                  {/* Header */}
                  <div className="flex items-center px-5 py-3.5 gap-3">
                    <button
                      onClick={() => setExpandedId(expanded ? null : m.staffId)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
                    >
                      {/* Avatar */}
                      <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white font-black text-sm ${m.weekendDaysMissed > 0 ? "bg-rose-500" : "bg-gradient-to-br from-indigo-500 to-purple-600"}`}>
                        {m.name.charAt(0).toUpperCase()}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-black text-slate-900 truncate">{m.name}</p>
                          {m.weekendDaysMissed > 0 && (
                            <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-700">
                              <ShieldAlert size={9} /> {m.weekendDaysMissed} wknd missed
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 uppercase tracking-wide">{m.role}</p>
                      </div>

                      {/* Stat pills (desktop) */}
                      <div className="hidden md:flex items-center gap-2 flex-shrink-0">
                        <StatPill label="Present" value={`${m.daysPresent}/${m.workingDaysInMonth}`} color="indigo" />
                        <StatPill label="Absent" value={String(m.daysAbsent)} color={m.daysAbsent > 3 ? "rose" : "slate"} />
                        <StatPill label="Late" value={String(m.lateArrivals)} color={m.lateArrivals > 2 ? "amber" : "slate"} />
                        <StatPill label="Weekend" value={weekendOk ? "✓" : `${m.weekendDaysMissed} miss`} color={weekendOk ? "emerald" : "rose"} />
                        {pay?.netPayable != null && (
                          <StatPill label="Net Pay" value={`₹${pay.netPayable.toLocaleString()}`} color="emerald" />
                        )}
                      </div>

                      {/* Attendance bar */}
                      <div className="hidden lg:block w-20 flex-shrink-0">
                        <div className="text-xs text-right font-bold text-slate-400 mb-1">{attendancePct}%</div>
                        <div className="h-1.5 rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${attendancePct >= 90 ? "bg-emerald-500" : attendancePct >= 70 ? "bg-amber-400" : "bg-rose-500"}`}
                            style={{ width: `${attendancePct}%` }}
                          />
                        </div>
                      </div>

                      <ChevronRight size={15} className={`flex-shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`} />
                    </button>

                    {/* Enroll face button */}
                    <Link
                      href={`/staff/${m.staffId}/enroll`}
                      className="flex-shrink-0 flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-bold text-purple-700 hover:bg-purple-100 transition-colors"
                    >
                      <Camera size={12} /> Enroll Face
                    </Link>
                  </div>

                  {/* Expanded Detail */}
                  {expanded && (
                    <div className="border-t border-slate-100 px-5 pb-6 pt-4 bg-slate-50/40">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">

                        {/* Attendance */}
                        <div>
                          <SectionHeading icon={<TrendingUp size={11} />} label="Attendance" />
                          <dl className="space-y-2 text-sm">
                            <Row label="Working days" value={String(m.workingDaysInMonth)} />
                            <Row label="Present" value={String(m.daysPresent)} highlight="emerald" />
                            <Row label="Absent" value={String(m.daysAbsent)} highlight={m.daysAbsent > 3 ? "rose" : undefined} />
                            <Row label="Late arrivals" value={String(m.lateArrivals)} highlight={m.lateArrivals > 0 ? "amber" : undefined} />
                            <Row label="Early exits" value={String(m.earlyDepartures)} highlight={m.earlyDepartures > 0 ? "rose" : undefined} />
                            <Row label="Avg hours/day" value={m.avgDailyMinutes > 0 ? formatMins(m.avgDailyMinutes) : "—"} />
                            <Row label="Total hours" value={m.totalMinutesWorked > 0 ? formatMins(m.totalMinutesWorked) : "—"} />
                          </dl>
                        </div>

                        {/* Weekend policy */}
                        <div>
                          <SectionHeading icon={<ShieldAlert size={11} />} label="Weekend Policy (Fri–Sun)" />
                          <dl className="space-y-2 text-sm mb-3">
                            <Row label="Policy weekends" value={String(m.weekendDaysInMonth)} />
                            <Row label="Attended" value={String(m.weekendDaysPresent)} highlight="emerald" />
                            <Row label="Missed" value={String(m.weekendDaysMissed)} highlight={m.weekendDaysMissed > 0 ? "rose" : undefined} bold={m.weekendDaysMissed > 0} />
                          </dl>
                          {m.weekendMissedDates.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-rose-500 mb-1">Missed dates</p>
                              {m.weekendMissedDates.map((d) => (
                                <div key={d} className="rounded-lg bg-rose-50 border border-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-700">
                                  {fmtDate(d)}
                                </div>
                              ))}
                            </div>
                          )}
                          {m.weekendDaysMissed === 0 && (
                            <p className="text-sm text-emerald-600 font-semibold">All weekends attended ✓</p>
                          )}
                        </div>

                        {/* Payroll */}
                        <div>
                          <SectionHeading icon={<DollarSign size={11} />} label="Payroll" />
                          {pay ? (
                            <dl className="space-y-2 text-sm">
                              <Row label="Type" value={m.payrollType} />
                              {m.payrollType === "SALARY" && (
                                <Row label="Gross" value={m.monthlySalary != null ? `₹${m.monthlySalary.toLocaleString()}` : "—"} />
                              )}
                              {m.payrollType === "DAILY" && (
                                <Row label="Daily wage" value={m.dailyWage != null ? `₹${m.dailyWage}/day` : "—"} />
                              )}
                              <Row label="Deduction days" value={String(pay.deductionDays)} highlight={pay.deductionDays > 0 ? "rose" : undefined} />
                              <Row label="Deduction" value={pay.deductionAmount != null ? `₹${pay.deductionAmount.toFixed(2)}` : "—"} highlight={pay.deductionAmount && pay.deductionAmount > 0 ? "rose" : undefined} />
                              <div className="border-t border-slate-200 pt-2 mt-2">
                                <Row label="Net payable" value={pay.netPayable != null ? `₹${pay.netPayable.toFixed(2)}` : "—"} highlight="emerald" bold />
                              </div>
                            </dl>
                          ) : (
                            <p className="text-sm text-slate-400">No salary configured</p>
                          )}
                        </div>

                        {/* Incidents */}
                        <div>
                          <SectionHeading icon={<AlertTriangle size={11} />} label="Incidents" />
                          {m.lateIncidents.length === 0 && m.earlyExitIncidents.length === 0 ? (
                            <p className="text-sm text-emerald-600 font-semibold">No incidents ✓</p>
                          ) : (
                            <div className="space-y-3">
                              {m.lateIncidents.length > 0 && (
                                <div>
                                  <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1">Late ({m.lateIncidents.length})</p>
                                  <div className="space-y-1">
                                    {m.lateIncidents.map((inc, i) => (
                                      <div key={i} className="flex justify-between text-xs bg-amber-50 rounded-lg px-3 py-1.5 border border-amber-100">
                                        <span className="font-semibold text-amber-800">{fmtDate(inc.date)}</span>
                                        <span className="text-amber-700">+{inc.minutesLate}m</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {m.earlyExitIncidents.length > 0 && (
                                <div>
                                  <p className="text-[10px] font-bold text-rose-700 uppercase tracking-wider mb-1">Early exit ({m.earlyExitIncidents.length})</p>
                                  <div className="space-y-1">
                                    {m.earlyExitIncidents.map((inc, i) => (
                                      <div key={i} className="flex justify-between text-xs bg-rose-50 rounded-lg px-3 py-1.5 border border-rose-100">
                                        <span className="font-semibold text-rose-800">{fmtDate(inc.date)}</span>
                                        <span className="text-rose-700">−{inc.minutesEarly}m</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {!loading && metrics.length === 0 && !error && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-16 text-center">
          <p className="text-slate-400 font-semibold">No attendance data for {monthLabel(month)}.</p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-6">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-200 border-t-indigo-600" />
        </div>
      )}
    </PageShell>
  )
}

function SummaryCard({ icon, label, value, color, badge }: { icon: React.ReactNode; label: string; value: string; color: string; badge?: string }) {
  const colors: Record<string, string> = {
    indigo: "bg-indigo-50 text-indigo-600", amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600", emerald: "bg-emerald-50 text-emerald-600", slate: "bg-slate-50 text-slate-500",
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className={`inline-flex rounded-xl p-2.5 mb-3 ${colors[color] ?? colors.slate}`}>{icon}</div>
      {badge && <span className="block text-[10px] font-bold uppercase tracking-wider text-rose-500 mb-1">{badge}</span>}
      <p className="text-2xl font-black text-slate-900 leading-none mb-1">{value}</p>
      <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">{label}</p>
    </div>
  )
}

function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-100", amber: "bg-amber-50 text-amber-700 border-amber-100",
    rose: "bg-rose-50 text-rose-700 border-rose-100", emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
    slate: "bg-slate-50 text-slate-600 border-slate-100",
  }
  return (
    <div className={`rounded-lg border px-2 py-1.5 text-center ${colors[color] ?? colors.slate}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-sm font-black">{value}</p>
    </div>
  )
}

function SectionHeading({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5">
      {icon} {label}
    </p>
  )
}

function Row({ label, value, highlight, bold }: { label: string; value: string; highlight?: string; bold?: boolean }) {
  const colors: Record<string, string> = { emerald: "text-emerald-700", amber: "text-amber-700", rose: "text-rose-600" }
  return (
    <div className="flex justify-between items-center">
      <span className="text-slate-500">{label}</span>
      <span className={`${bold ? "font-black text-base" : "font-semibold"} ${highlight ? (colors[highlight] ?? "") : "text-slate-800"}`}>{value}</span>
    </div>
  )
}
