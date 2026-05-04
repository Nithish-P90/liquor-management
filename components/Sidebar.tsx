"use client"

import React, { useState } from "react"
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
  ChevronLeft,
  ChevronRight,
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
  const [isHovered, setIsHovered] = useState(false)
  const collapsed = !isHovered
  const items = NAV_ITEMS.filter((item) => (item.adminOnly ? role === "ADMIN" : true))

  return (
    <aside 
      id="app-sidebar" 
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`relative flex h-screen flex-col border-r-2 border-slate-100 bg-white transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${collapsed ? "w-24" : "w-80 shadow-2xl z-[100]"}`}
    >
      <div className={`px-6 py-12 transition-all duration-500 ${collapsed ? "items-center px-4" : ""}`}>
        <div className={`flex flex-col ${collapsed ? "items-center" : ""}`}>
          <p className={`text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 transition-all duration-500 ${collapsed ? "opacity-0 -translate-y-2 h-0" : "opacity-100 mb-2 translate-y-0"}`}>
            Operations Console
          </p>
          <h1 className={`font-black tracking-tighter text-slate-900 border-b-4 border-slate-900 transition-all duration-700 ${collapsed ? "text-sm pb-1" : "text-3xl pb-2"}`}>
            {collapsed ? "MV" : "MAHAVISHNU"}
          </h1>
        </div>
      </div>

      <nav className={`flex-1 space-y-2 overflow-y-auto px-4 py-4 no-scrollbar`}>
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : ""}
              className={`group flex items-center gap-4 rounded-2xl px-4 py-3.5 transition-all duration-300 active:scale-95 ${
                active 
                ? "bg-slate-900 text-white shadow-xl shadow-slate-900/20" 
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              } ${collapsed ? "justify-center px-0" : ""}`}
            >
              <item.icon size={20} className={`transition-transform duration-300 group-hover:scale-110 ${active ? "text-white" : "text-slate-400 group-hover:text-slate-900"}`} />
              {!collapsed && (
                <span className="text-[11px] font-black uppercase tracking-widest whitespace-nowrap overflow-hidden">
                  {item.label}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <div className={`border-t-2 border-slate-50 p-6 transition-all duration-500 ${collapsed ? "p-4" : ""}`}>
        <div className={`flex items-center gap-4 mb-8 ${collapsed ? "justify-center" : ""}`}>
          <div className="h-10 w-10 shrink-0 rounded-2xl bg-slate-900 flex items-center justify-center text-xs font-black text-white shadow-lg">
            {name.charAt(0)}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-black text-slate-900 uppercase tracking-tight">{name}</p>
              <p className="text-[9px] font-black text-emerald-600 uppercase tracking-[0.2em] mt-0.5">{role}</p>
            </div>
          )}
        </div>
        <button 
          type="button" 
          title="Sign Out"
          className={`flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-slate-100 bg-white py-4 transition-all hover:border-rose-200 hover:text-rose-600 active:scale-95 shadow-sm ${collapsed ? "px-0" : ""}`}
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <LogOut size={16} />
          {!collapsed && <span className="text-[10px] font-black uppercase tracking-widest">Sign Out</span>}
        </button>
      </div>
    </aside>
  )
}
