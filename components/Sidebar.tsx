"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"

import { Button } from "@/components/ui/Button"

type AppRole = "ADMIN" | "CASHIER"

type SidebarProps = {
  name: string
  role: AppRole
}

type NavItem = {
  href: string
  label: string
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", adminOnly: true },
  { href: "/pos", label: "POS" },
  { href: "/ledger", label: "Ledger", adminOnly: true },
  { href: "/sales", label: "Sales" },
  { href: "/products", label: "Products", adminOnly: true },
  { href: "/indents", label: "Indents (KSBCL)", adminOnly: true },
  { href: "/clearance", label: "Clearance", adminOnly: true },
  { href: "/inventory", label: "Inventory", adminOnly: true },
  { href: "/staff", label: "Staff", adminOnly: true },
  { href: "/attendance", label: "Attendance" },
  { href: "/cash/close", label: "Cash Close" },
  { href: "/expenses", label: "Expenses" },
  { href: "/misc-sale", label: "Misc Sales" },
  { href: "/clerks", label: "Clerks", adminOnly: true },
  { href: "/reports", label: "Reports", adminOnly: true },
  { href: "/settings", label: "Settings", adminOnly: true },
]

export function Sidebar({ name, role }: SidebarProps): JSX.Element {
  const pathname = usePathname()
  const items = NAV_ITEMS.filter((item) => (item.adminOnly ? role === "ADMIN" : true))

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-slate-800 bg-slate-950">
      <div className="border-b border-slate-800 px-5 py-4">
        <p className="text-sm text-slate-400">Mahavishnu Liquor Manager</p>
        <h1 className="text-lg font-semibold text-slate-100">Operations Console</h1>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-md px-3 py-2 text-sm transition ${
                active ? "bg-emerald-500/20 text-emerald-300" : "text-slate-300 hover:bg-slate-900 hover:text-slate-100"
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-slate-800 p-4">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
          <p className="text-sm text-slate-200">{name}</p>
          <p className="text-xs uppercase tracking-wide text-amber-400">{role}</p>
        </div>
        <Button type="button" variant="secondary" className="mt-3 w-full" onClick={() => signOut({ callbackUrl: "/login" })}>
          Sign Out
        </Button>
      </div>
    </aside>
  )
}
