'use client'
import { useEffect, useState } from 'react'
import { getSession, signIn, useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

function routeForRole(role?: string) {
  return role === 'STAFF' ? '/pos' : '/dashboard'
}

export default function LoginPage() {
  const router = useRouter()
  const { data: existingSession, status } = useSession()
  const [mode, setMode] = useState<'email' | 'pin'>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const res = await signIn('credentials', { email, password, redirect: false })
    setLoading(false)
    if (res?.ok) await redirectAfterLogin()
    else setError('Invalid email or password')
  }

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

        {/* Mode Toggle */}
        <div className="flex rounded-lg bg-gray-100 p-1 mb-6">
          <button
            onClick={() => { setMode('email'); setError('') }}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${mode === 'email' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}
          >
            Admin Login
          </button>
          <button
            onClick={() => { setMode('pin'); setError('') }}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${mode === 'pin' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}
          >
            Staff PIN
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        {mode === 'email' ? (
          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="admin@mv.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)} required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit" disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        ) : (
          <form onSubmit={handlePinLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2 text-center">Enter 4-Digit PIN</label>
              <div className="flex justify-center">
                <input
                  type="password" value={pin} onChange={e => setPin(e.target.value.slice(0,4))} maxLength={4}
                  className="w-40 text-center text-3xl tracking-[0.5em] px-4 py-4 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono"
                  placeholder="----" inputMode="numeric" pattern="[0-9]*" autoFocus
                />
              </div>
            </div>
            <button
              type="submit" disabled={loading || pin.length !== 4}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Login with PIN'}
            </button>
          </form>
        )}

        <p className="text-center text-xs text-gray-400 mt-6">
          MV Liquor Management System v1.0 • License: 07458
        </p>
      </div>
    </div>
  )
}
