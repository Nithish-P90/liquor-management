"use client"

import React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import {
  LayoutDashboard,
  ShoppingBag,
  BarChart3,
  Receipt,
  Package,
  Tags,
  Users,
  Clock,
  Activity,
  CreditCard,
  TrendingUp,
  PlusSquare,
  ShieldCheck,
  Settings,
  LogOut
} from "lucide-react"

type AppRole = "ADMIN" | "CASHIER"

type SidebarProps = {
  name: string
  role: AppRole
}

type NavItem = {
  href: string
  label: string
  icon: React.ElementType
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, adminOnly: true },
  { href: "/pos", label: "Terminal", icon: ShoppingBag },
  { href: "/ledger", label: "Ledger", icon: BarChart3, adminOnly: true },
  { href: "/sales", label: "Sales Log", icon: Receipt },
  { href: "/indents", label: "Procurement", icon: Package, adminOnly: true },
  { href: "/clearance", label: "Clearance", icon: Tags, adminOnly: true },
  { href: "/inventory", label: "Inventory", icon: Package, adminOnly: true },
  { href: "/staff", label: "Staff", icon: Users, adminOnly: true },
  { href: "/attendance", label: "Kiosk", icon: Clock },
  { href: "/attendance/metrics", label: "Attendance", icon: Activity, adminOnly: true },
  { href: "/cash/close", label: "Settlement", icon: CreditCard },
  { href: "/expenses", label: "Payouts", icon: TrendingUp },
  { href: "/misc-sale", label: "Misc Goods", icon: PlusSquare },
  { href: "/clerks", label: "Clerks", icon: ShieldCheck, adminOnly: true },
  { href: "/reports", label: "Analytics", icon: BarChart3, adminOnly: true },
  { href: "/settings", label: "Control", icon: Settings, adminOnly: true },
]

export function Sidebar({ name, role }: SidebarProps): JSX.Element {
  const pathname = usePathname()
  const items = NAV_ITEMS.filter((item) => (item.adminOnly ? role === "ADMIN" : true))

  return (
    <>
      {/* Spacer keeps page content from shifting */}
      <div className="w-14 shrink-0" />

      <aside
        id="app-sidebar"
        className="group fixed left-0 top-0 z-[100] flex h-screen w-14 flex-col overflow-hidden border-r-2 border-slate-100 bg-white transition-[width,box-shadow] duration-200 ease-out hover:w-52 hover:shadow-xl hover:shadow-black/10"
      >
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center px-3">
          <div className="flex items-center gap-3 overflow-hidden">
            <span className="shrink-0 border-b-2 border-slate-900 pb-0.5 text-sm font-black leading-none tracking-tighter text-slate-900">MV</span>
            <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs font-black uppercase tracking-widest text-slate-900 opacity-0 transition-[opacity,max-width] duration-200 group-hover:max-w-xs group-hover:opacity-100">
              Mahavishnu
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav className="no-scrollbar flex-1 space-y-0.5 overflow-x-hidden overflow-y-auto px-2 py-2">
          {items.map((item) => {
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={`flex items-center gap-3 rounded-xl px-2 py-2 transition-colors duration-150 active:scale-95 ${
                  active
                    ? "bg-slate-900 text-white"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <item.icon size={18} className="shrink-0" />
                <span className="max-w-0 overflow-hidden whitespace-nowrap text-[11px] font-black uppercase tracking-widest opacity-0 transition-[opacity,max-width] duration-200 group-hover:max-w-xs group-hover:opacity-100">
                  {item.label}
                </span>
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="shrink-0 space-y-2 border-t-2 border-slate-50 px-2 py-3">
          <div className="flex items-center gap-3 overflow-hidden px-1">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-[10px] font-black text-white">
              {name.charAt(0)}
            </div>
            <div className="max-w-0 min-w-0 overflow-hidden opacity-0 transition-[opacity,max-width] duration-200 group-hover:max-w-xs group-hover:opacity-100">
              <p className="truncate text-[11px] font-black uppercase tracking-tight text-slate-900">{name}</p>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-600">{role}</p>
            </div>
          </div>
          <button
            type="button"
            title="Sign Out"
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-slate-100 bg-white py-2 transition-colors hover:border-rose-200 hover:text-rose-600 active:scale-95"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut size={14} />
            <span className="max-w-0 overflow-hidden whitespace-nowrap text-[10px] font-black uppercase tracking-[0.18em] opacity-0 transition-[opacity,max-width] duration-200 group-hover:max-w-xs group-hover:opacity-100">
              Sign Out
            </span>
          </button>
        </div>
      </aside>
    </>
  )
}
