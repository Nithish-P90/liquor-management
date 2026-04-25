"use client"

import { FormEvent, useMemo, useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/Button"

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]

export default function LoginPage(): JSX.Element {
  const router = useRouter()
  const [pin, setPin] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const maskedPin = useMemo(() => "•".repeat(pin.length), [pin])

  function appendDigit(digit: string): void {
    if (pin.length >= 4 || loading) return
    setPin((prev) => `${prev}${digit}`)
    setError(null)
  }

  function clearOne(): void {
    if (loading) return
    setPin((prev) => prev.slice(0, -1))
  }

  function clearAll(): void {
    if (loading) return
    setPin("")
    setError(null)
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()

    if (!/^\d{4}$/.test(pin)) {
      setError("Enter a 4-digit PIN")
      return
    }

    setLoading(true)
    setError(null)

    const result = await signIn("credentials", {
      pin,
      redirect: false,
    })

    setLoading(false)

    if (!result || result.error) {
      setError("Invalid PIN")
      return
    }

    router.push("/dashboard")
    router.refresh()
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-black/40">
        <h1 className="text-xl font-semibold text-slate-100">Staff Login</h1>
        <p className="mt-1 text-sm text-slate-400">Enter your 4-digit POS PIN</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="rounded-md border border-slate-700 bg-slate-950 px-3 py-4 text-center text-2xl tracking-[0.3em] text-slate-100">
            {maskedPin || "----"}
          </div>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <div className="grid grid-cols-3 gap-2">
            {DIGITS.map((digit) => (
              <Button
                key={digit}
                type="button"
                variant="secondary"
                onClick={() => appendDigit(digit)}
                disabled={loading || pin.length >= 4}
              >
                {digit}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="ghost" onClick={clearOne} disabled={loading || pin.length === 0}>
              Backspace
            </Button>
            <Button type="button" variant="ghost" onClick={clearAll} disabled={loading || pin.length === 0}>
              Clear
            </Button>
          </div>

          <Button type="submit" className="w-full" disabled={loading || pin.length !== 4}>
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </form>
      </div>
    </div>
  )
}
