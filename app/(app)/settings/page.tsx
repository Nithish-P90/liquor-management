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
    <PageShell title="System Settings" subtitle="Configure application-wide variables and thresholds.">
      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading settings...</p>
      ) : (
        <form onSubmit={handleSave} className="max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="space-y-6">
            {keys.map((k) => (
              <div key={k.key}>
                <label className="block text-sm font-bold text-slate-700 mb-1">{k.label}</label>
                <input
                  type="text"
                  value={settings[k.key] || ""}
                  onChange={(e) => handleChange(k.key, e.target.value)}
                  placeholder={`Enter ${k.label.toLowerCase()}`}
                  className="w-full rounded-lg border border-slate-300 px-4 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            ))}
          </div>

          <div className="mt-8 pt-6 border-t border-slate-100 flex justify-end">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </form>
      )}
    </PageShell>
  )
}
