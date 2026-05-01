"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"

export default function LoginPage(): JSX.Element {
  const router = useRouter()
  const [pin, setPin] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Auto-focus input for keyboard-only flow
    inputRef.current?.focus()

    // Keep focus even if clicking elsewhere
    const handleFocus = () => inputRef.current?.focus()
    window.addEventListener("click", handleFocus)
    return () => window.removeEventListener("click", handleFocus)
  }, [])

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()

    if (!/^\d{4,6}$/.test(pin)) {
      setError("Enter a 4-6 digit PIN")
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
      setPin("")
      inputRef.current?.focus()
      return
    }

    router.push("/dashboard")
    router.refresh()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">POS Login</h1>
          <p className="mt-2 text-sm text-slate-600">Scan or type PIN to start session</p>
        </div>

        <form onSubmit={submit} className="space-y-6">
          <div className="relative">
            <Input
              ref={inputRef}
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              value={pin}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "").slice(0, 6)
                setPin(val)
                if (val.length === 4 || val.length === 6) {
                  // Optional: could auto-submit here, but manual Enter is safer for keyboard
                }
              }}
              className="h-16 text-center text-4xl tracking-[0.5em] focus-visible:ring-2 focus-visible:ring-indigo-500"
              placeholder="••••"
              disabled={loading}
              autoFocus
            />
            {error ? (
              <p className="absolute -bottom-6 left-0 w-full text-center text-xs font-medium text-red-500">
                {error}
              </p>
            ) : null}
          </div>

          <div className="pt-2">
            <Button
              type="submit"
              size="lg"
              className="h-12 w-full text-lg font-semibold"
              disabled={loading || pin.length < 4}
            >
              {loading ? "Verifying..." : "ENTER"}
            </Button>
          </div>

          <div className="text-center text-[10px] text-slate-400">
            KEYBOARD ONLY • PRESS ENTER TO LOGIN
          </div>
        </form>
      </div>
    </div>
  )
}
