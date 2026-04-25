"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/Button"
import { PageShell } from "@/components/PageShell"

type Staff = { id: number; name: string; role: string }
type AttendanceEvent = {
  id: number
  staff: { name: string; role: string }
  eventType: string
  method: string
  occurredAt: string
  isLate: boolean
  isEarlyDeparture: boolean
}

export default function AttendancePage(): JSX.Element {
  const [staff, setStaff] = useState<Staff[]>([])
  const [events, setEvents] = useState<AttendanceEvent[]>([])
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null)
  const [processing, setProcessing] = useState(false)
  const [lastResult, setLastResult] = useState<{ message: string; ok: boolean } | null>(null)

  useEffect(() => {
    fetch("/api/staff").then((r) => r.json()).then((data) => {
      setStaff(Array.isArray(data) ? data : [])
    }).catch(() => {})

    fetchEvents()
    const interval = setInterval(fetchEvents, 30000)
    return () => clearInterval(interval)
  }, [])

  async function fetchEvents(): Promise<void> {
    try {
      const res = await fetch("/api/attendance")
      setEvents(await res.json())
    } catch { /* silent */ }
  }

  async function handlePunch(): Promise<void> {
    if (!selectedStaffId) return
    setProcessing(true)
    setLastResult(null)

    const res = await fetch("/api/attendance/punch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffId: selectedStaffId, method: "PIN" }),
    })

    setProcessing(false)
    if (res.ok) {
      const data = await res.json()
      setLastResult({ message: data.message, ok: !data.isLate && !data.isEarlyDeparture })
      setSelectedStaffId(null)
      fetchEvents()
    } else {
      const err = await res.json()
      setLastResult({ message: err.error ?? "Punch failed", ok: false })
    }

    setTimeout(() => setLastResult(null), 5000)
  }

  return (
    <PageShell title="Attendance Kiosk" subtitle="Clock in / out by selecting staff and confirming.">
      <div className="grid grid-cols-3 gap-6">
        {/* Punch panel */}
        <div className="col-span-1 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="mb-4 text-sm font-semibold text-slate-200">Clock In / Out</h3>

          {lastResult && (
            <div className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium ${lastResult.ok ? "bg-emerald-900/50 text-emerald-300" : "bg-amber-900/50 text-amber-300"}`}>
              {lastResult.message}
            </div>
          )}

          <div className="mb-4">
            <label className="mb-1 block text-xs text-slate-400">Select Staff</label>
            <select
              value={selectedStaffId ?? ""}
              onChange={(e) => setSelectedStaffId(e.target.value ? parseInt(e.target.value, 10) : null)}
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">Select staff member…</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
              ))}
            </select>
          </div>

          <Button
            variant="primary"
            className="w-full"
            onClick={handlePunch}
            disabled={!selectedStaffId || processing}
          >
            {processing ? "Processing…" : "Punch In/Out"}
          </Button>
        </div>

        {/* Today's log */}
        <div className="col-span-2 rounded-lg border border-slate-800">
          <div className="border-b border-slate-800 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-200">Today{"'"}s Log</h3>
          </div>
          {events.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">No attendance events today.</p>
          ) : (
            <div className="divide-y divide-slate-800">
              {events.map((event) => (
                <div key={event.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-100">{event.staff.name}</p>
                    <p className="text-xs text-slate-400">{event.staff.role}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {event.isLate && (
                      <span className="rounded-full bg-amber-900/50 px-2 py-0.5 text-xs text-amber-300">LATE</span>
                    )}
                    {event.isEarlyDeparture && (
                      <span className="rounded-full bg-orange-900/50 px-2 py-0.5 text-xs text-orange-300">EARLY</span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${event.eventType === "CLOCK_IN" ? "bg-emerald-900/50 text-emerald-300" : "bg-blue-900/50 text-blue-300"}`}>
                      {event.eventType.replace("_", " ")}
                    </span>
                    <span className="text-xs text-slate-400">
                      {new Date(event.occurredAt).toLocaleTimeString("en-IN")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
}
