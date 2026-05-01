import { Role } from "@prisma/client"
import CredentialsProvider from "next-auth/providers/credentials"
import { type NextAuthOptions } from "next-auth"

import { prisma } from "@/lib/platform/prisma"

const ALLOWED_PIN_ROLES: Role[] = ["ADMIN", "CASHIER"]

function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin)
}

function isLoginRole(role: Role): role is Extract<Role, "ADMIN" | "CASHIER"> {
  return role === "ADMIN" || role === "CASHIER"
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "PIN",
      credentials: {
        pin: { label: "PIN", type: "password", placeholder: "0000" },
      },
      async authorize(credentials) {
        const pin = credentials?.pin?.trim() ?? ""

        if (!isValidPin(pin)) {
          return null
        }

        try {
          const staff = await prisma.staff.findFirst({
            where: {
              pin,
              active: true,
              role: { in: ALLOWED_PIN_ROLES },
            },
            select: { id: true, name: true, role: true },
          })

          if (!staff) {
            const fallbackEnabled = process.env.ALLOW_PIN_FALLBACK === "true"
            const fallbackPin = process.env.FALLBACK_PIN

            if (fallbackEnabled && fallbackPin && pin === fallbackPin) {
              return {
                id: "fallback-admin",
                name: "Emergency Admin",
                role: "ADMIN",
              }
            }
            return null
          }

          if (!isLoginRole(staff.role)) {
            return null
          }

          return {
            id: String(staff.id),
            name: staff.name,
            role: staff.role,
          }
        } catch {
          const fallbackEnabled = process.env.ALLOW_PIN_FALLBACK === "true"
          const fallbackPin = process.env.FALLBACK_PIN

          if (fallbackEnabled && fallbackPin && pin === fallbackPin) {
            return {
              id: "fallback-admin",
              name: "Emergency Admin",
              role: "ADMIN",
            }
          }

          return null
        }
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
      }
      return token
    },
    async session({ session, token }) {
      if (session.user && token.id && token.role) {
        session.user.id = token.id
        session.user.role = token.role
      }
      return session
    },
  },
  pages: {
    signIn: "/login",
  },
}
