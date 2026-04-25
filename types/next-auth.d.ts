import type { Role } from "@prisma/client"
import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      role: Extract<Role, "ADMIN" | "CASHIER">
    } & DefaultSession["user"]
  }

  interface User {
    id: string
    role: Extract<Role, "ADMIN" | "CASHIER">
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string
    role?: Extract<Role, "ADMIN" | "CASHIER">
  }
}
