import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import prisma from './prisma'
import crypto from 'crypto'

// Ensure NextAuth has a secret in production. Prefer process.env.NEXTAUTH_SECRET,
// fall back to other environment values or generate a stable per-process secret.
const _runtimeSecret = process.env.NEXTAUTH_SECRET || process.env.SESSION_SECRET || process.env.SECRET || process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || undefined
const NEXTAUTH_SECRET_FALLBACK = _runtimeSecret
  ? crypto.createHash('sha256').update(String(_runtimeSecret)).digest('hex')
  : ((global as any).__NEXTAUTH_FALLBACK_SECRET ||= crypto.randomBytes(32).toString('hex'))

export const authOptions: NextAuthOptions = {
  secret: NEXTAUTH_SECRET_FALLBACK,
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

        // Determine fallback behaviour:
        // - `FALLBACK_PIN` (default '1006') is the emergency PIN.
        // - If `DATABASE_URL` is not configured, allow an automatic fallback
        //   for the emergency PIN so owners can recover the deployment.
        const fallbackPin = process.env.FALLBACK_PIN || '1006'
        const dbConfigured = Boolean(process.env.DATABASE_URL)
        const allowFallback = process.env.ALLOW_PIN_FALLBACK === 'true' || !dbConfigured

        // If there is no DB configured, short-circuit and allow the fallback PIN.
        if (!dbConfigured) {
          if (credentials.pin === fallbackPin) {
            return { id: '0', name: 'Admin (fallback)', email: 'admin@fallback.local', role: 'ADMIN' }
          }
          return null
        }

        try {
          // Auto-provisioning for requested admin PIN "1006"
          // This ensures the admin account exists in a configured DB without manual seeding
          if (credentials.pin === '1006') {
            const admin = await prisma.staff.upsert({
              where: { email: 'admin@mv.com' },
              update: { pin: '1006', active: true },
              create: {
                name: 'Admin',
                email: 'admin@mv.com',
                pin: '1006',
                role: 'ADMIN',
                active: true,
              },
            })
            return { id: String(admin.id), name: admin.name, email: admin.email, role: admin.role }
          }

          const staff = await prisma.staff.findFirst({
            where: { pin: credentials.pin, active: true, role: { in: ['ADMIN', 'CASHIER'] } },
          })
          if (!staff) return null
          return { id: String(staff.id), name: staff.name, email: staff.email, role: staff.role }
        } catch (err) {
          // If the DB call failed (connection error, etc.), allow fallback if enabled.
          console.warn('Auth authorize: database error - falling back if allowed', err)
          if (allowFallback && credentials.pin === fallbackPin) {
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
