"use client"

import { useEffect, useState } from "react"

import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"

export default function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Default keys we care about
  const keys = [
    { key: "SHOP_NAME", label: "Shop Name" },
    { key: "CL2_LICENSE", label: "License Number" },
    { key: "PRINTER_IP", label: "Printer IP Address" },
    { key: "LATE_GRACE_MINS", label: "Late Grace Period (mins)" },
  ]

  useEffect(() => {
    fetchSettings()
  }, [])

  async function fetchSettings() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/settings")
      if (!res.ok) throw new Error("Failed to load settings")
      setSettings(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error loading settings")
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      })
      if (!res.ok) {
        const { error } = await res.json()
        throw new Error(error || "Failed to save settings")
      }
      alert("Settings saved successfully!")
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  function handleChange(key: string, val: string) {
    setSettings((prev) => ({ ...prev, [key]: val }))
  }

  return (
    <PageShell title="Global Configuration" subtitle="Define application-wide operational variables, regulatory thresholds, and system identities.">
      <div className="mb-5 border-b-2 border-slate-50 pb-8">
        <h2 className="text-2xl font-black text-slate-900 tracking-tight">System Environment</h2>
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 mt-1">Administrative Variable Control</p>
      </div>
      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-3 text-center text-slate-400 font-black uppercase tracking-[0.2em] text-[11px]">Syncing Environment Variables…</div>
      ) : (
        <form onSubmit={handleSave} className="max-w-3xl rounded-xl border-2 border-slate-100 bg-white p-5 shadow-sm">
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {keys.map((k) => (
                <div key={k.key} className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-1">{k.label}</label>
                  <input
                    type="text"
                    value={settings[k.key] || ""}
                    onChange={(e) => handleChange(k.key, e.target.value)}
                    placeholder={`Define ${k.label.toLowerCase()}...`}
                    className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-5 py-4 text-base font-black text-slate-800 focus:border-indigo-400 focus:bg-white focus:outline-none transition-all"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 pt-10 border-t-2 border-slate-50 flex justify-end">
            <Button type="submit" variant="primary" disabled={saving} className="rounded-2xl px-5 py-4 font-black uppercase tracking-widest text-[11px] shadow-xl shadow-slate-900/10 active:scale-95 transition-all">
              {saving ? "Deploying Updates…" : "Commit Changes"}
            </Button>
          </div>
        </form>
      )}
    </PageShell>
  )
}
