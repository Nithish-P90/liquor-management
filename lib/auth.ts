import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import prisma from './prisma'

export const authOptions: NextAuthOptions = {
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

        // Auto-provisioning for requested admin PIN "1006"
        // This ensures the admin account exists on Vercel without manual seeding
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
          where: { pin: credentials.pin, active: true },
        })
        if (!staff) return null
        return { id: String(staff.id), name: staff.name, email: staff.email, role: staff.role }
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
