import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { compare } from 'bcryptjs'
import prisma from './prisma'

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      id: 'credentials',
      name: 'Email & Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        const staff = await prisma.staff.findUnique({
          where: { email: credentials.email, active: true },
        })
        if (!staff) return null
        const valid = await compare(credentials.password, staff.passwordHash)
        if (!valid) return null
        return { id: String(staff.id), name: staff.name, email: staff.email, role: staff.role }
      },
    }),
    CredentialsProvider({
      id: 'pin',
      name: 'PIN Login',
      credentials: {
        pin: { label: '4-Digit PIN', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.pin) return null
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
