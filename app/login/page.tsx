'use client'
import { useEffect, useState } from 'react'
import { getSession, signIn, useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

function routeForRole(role?: string) {
  if (role === 'ADMIN') return '/dashboard'
  if (role === 'CASHIER') return '/pos'
  return '/login' // Others should not be able to log in to the software or will be blocked by layout
}

export default function LoginPage() {
  const router = useRouter()
  const { data: existingSession, status } = useSession()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function redirectAfterLogin() {
    const currentSession = await getSession()
    const user = currentSession?.user as { role?: string } | undefined
    router.replace(routeForRole(user?.role))
  }

  useEffect(() => {
    if (status === 'authenticated') {
      const user = existingSession?.user as { role?: string } | undefined
      router.replace(routeForRole(user?.role))
    }
  }, [existingSession, router, status])

  async function handlePinLogin(e: React.FormEvent) {
    e.preventDefault()
    if (pin.length !== 4) { setError('Enter 4-digit PIN'); return }
    setLoading(true); setError('')
    const res = await signIn('pin', { pin, redirect: false })
    setLoading(false)
    if (res?.ok) await redirectAfterLogin()
    else setError('Invalid PIN')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-blue-700">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🍶</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Mahavishnu Wines</h1>
          <p className="text-gray-500 text-sm mt-1">Inventory Management System</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handlePinLogin} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-4 text-center">Enter 4-Digit Security PIN</label>
            <div className="flex justify-center">
              <input
                type="text" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0,4))} maxLength={4}
                className="w-48 text-center text-4xl tracking-[0.5em] px-4 py-5 border-2 border-gray-200 rounded-2xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-mono transition-all shadow-inner"
                placeholder="----" inputMode="numeric" pattern="[0-9]*" autoFocus
              />
            </div>
          </div>
          <button
            type="submit" disabled={loading || pin.length !== 4}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-lg rounded-xl transition-all shadow-lg active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? 'Verifying...' : 'Unlock System'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6">
          MV Liquor Management System v1.0 • License: 07458
        </p>
      </div>
    </div>
  )
}
