"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"

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
    <aside id="app-sidebar" className="flex h-screen w-64 flex-col border-r border-slate-200 bg-white">
      <div className="px-6 py-10">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Operations Console</p>
        <h1 className="mt-1 text-xl font-black tracking-tight text-slate-900 border-b-2 border-slate-900 pb-2 inline-block">MAHAVISHNU</h1>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-4">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center rounded-lg px-3 py-2.5 text-xs font-bold uppercase tracking-wider transition ${
                active 
                ? "bg-slate-900 text-white" 
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-slate-100 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-900">
            {name.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-slate-900 uppercase">{name}</p>
            <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">{role}</p>
          </div>
        </div>
        <button 
          type="button" 
          className="w-full rounded-lg border border-slate-200 bg-white py-2 text-[10px] font-black uppercase tracking-widest text-slate-400 transition hover:border-slate-900 hover:text-slate-900 active:scale-95"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          Sign Out
        </button>
      </div>
    </aside>
  )
}
