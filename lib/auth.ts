import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import prisma from './prisma'
import crypto from 'crypto'

// NEXTAUTH_SECRET is required in production. In development, fall back to a
// per-process random secret (sessions won't survive restarts — acceptable for dev).
function resolveSecret(): string {
  if (process.env.NEXTAUTH_SECRET) return process.env.NEXTAUTH_SECRET
  if (process.env.NODE_ENV === 'production') {
    console.error('CRITICAL: NEXTAUTH_SECRET is not set in production. Sessions will be insecure.')
  }
  return ((global as Record<string, unknown>).__NEXTAUTH_DEV_SECRET ??=
    crypto.randomBytes(32).toString('hex')) as string
}

export const authOptions: NextAuthOptions = {
  secret: resolveSecret(),
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      id: 'pin',
      name: 'PIN Login',
      credentials: {
        pin: { label: '4-Digit PIN', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.pin) return null

        // Validate PIN format: must be exactly 4 digits
        if (!/^\d{4}$/.test(credentials.pin)) return null

        const dbConfigured = Boolean(process.env.DATABASE_URL)

        // If there is no DB configured, allow fallback PIN for recovery only.
        // FALLBACK_PIN must be explicitly set in env — no default hardcoded PIN.
        if (!dbConfigured) {
          const fallbackPin = process.env.FALLBACK_PIN
          if (fallbackPin && credentials.pin === fallbackPin) {
            return { id: '0', name: 'Admin (fallback)', email: 'admin@fallback.local', role: 'ADMIN' }
          }
          return null
        }

        try {
          const staff = await prisma.staff.findFirst({
            where: { pin: credentials.pin, active: true, role: { in: ['ADMIN', 'CASHIER'] } },
          })
          if (!staff) return null
          return { id: String(staff.id), name: staff.name, email: staff.email, role: staff.role }
        } catch (err) {
          console.error('Auth: database error during login', err)
          // Only allow fallback if explicitly configured and DB is down
          const fallbackPin = process.env.FALLBACK_PIN
          if (process.env.ALLOW_PIN_FALLBACK === 'true' && fallbackPin && credentials.pin === fallbackPin) {
            return { id: '0', name: 'Admin (fallback)', email: 'admin@fallback.local', role: 'ADMIN' }
          }
          return null
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as any).role
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id
        ;(session.user as any).role = token.role
      }
      return session
    },
  },
}
