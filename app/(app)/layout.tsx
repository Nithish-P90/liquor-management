'use client'
import { useSession, signOut } from 'next-auth/react'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect } from 'react'
import Link from 'next/link'

// ── Navigation items ──────────────────────────────────────────────────────────

const adminNav = [
  {
    group: 'Operations',
    items: [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/pos', label: 'Point of Sale' },
      { href: '/misc-sale', label: 'Misc Sale' },
      { href: '/clerks', label: 'Clerk Billing' },
      { href: '/sales', label: 'Sales History' },
    ],
  },
  {
    group: 'Inventory',
    items: [
      { href: '/inventory', label: 'Stock Overview' },
      { href: '/inventory/opening', label: 'Opening Stock' },
      { href: '/indents', label: 'Indents (KSBCL)' },
    ],
  },
  {
    group: 'Finance',
    items: [
      { href: '/cash', label: 'Cash Register' },
      { href: '/expenses', label: 'Expenditure' },
      { href: '/reports/daily', label: 'Daily Ledger' },
      { href: '/reports', label: 'All Reports' },
    ],
  },
  {
    group: 'Admin',
    items: [
      { href: '/products', label: 'Products' },
      { href: '/staff', label: 'Staff Directory' },
      { href: '/attendance', label: 'Face Attendance' },
      { href: '/settings', label: 'Settings' },
    ],
  },
]

// Staff sidebar (POS + cash + expenses + inventory)
const staffNav = [
  {
    group: 'Counter',
    items: [
      { href: '/pos', label: 'Point of Sale' },
      { href: '/misc-sale', label: 'Misc Sale' },
      { href: '/clerks', label: 'Clerk Billing' },
      { href: '/sales', label: 'Bill History' },
      { href: '/attendance', label: 'Face Attendance' },
      { href: '/cash', label: 'Cash Register' },
      { href: '/expenses', label: 'Expenditure' },
    ],
  },
  {
    group: 'Inventory',
    items: [
      { href: '/inventory', label: 'Stock Overview' },
      { href: '/indents', label: 'Indents (KSBCL)' },
    ],
  },
]

// Staff can access POS, cash register, expenses, and inventory
const STAFF_ALLOWED = ['/pos', '/misc-sale', '/clerks', '/sales', '/cash', '/expenses', '/inventory', '/indents', '/attendance']

// ── Layout ────────────────────────────────────────────────────────────────────

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const router = useRouter()
  const pathname = usePathname()

  const user = session?.user as { id?: string; name?: string; role?: string } | undefined
  const isStaff = user?.role !== 'ADMIN'

  // ── Auth guard & Rollover Trigger ──────────────────────────────────────────
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login')
    } else if (status === 'authenticated') {
      // Fire and forget Lazy Rollover initialization
      // This will scan if yesterday was closed. If left open, it dynamically calculates
      // the math and automatically spawns the closing stock and carries it to today's Opening.
      fetch('/api/rollover/lazy', { method: 'POST' }).catch(() => {})
    }
  }, [status, router])

  // Staff: redirect to POS if trying to access admin pages
  useEffect(() => {
    if (status === 'authenticated' && isStaff) {
      const allowed = STAFF_ALLOWED.some(p => pathname.startsWith(p))
      if (!allowed) router.replace('/pos')
    }
  }, [pathname, isStaff, status, router])

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) return null

  const nav = isStaff ? staffNav : adminNav

  // Shared sidebar layout for both admin and staff
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* ── Sidebar ────────────────────────────────────────────────────── */}
      <aside className="w-48 bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
        {/* Brand */}
        <div className="px-5 py-6 border-b border-slate-100 mb-2">
          <div className="text-slate-900 font-extrabold text-[13px] leading-tight tracking-tight uppercase">Mahavishnu Wines</div>
          <div className="text-slate-400 text-[10px] mt-0.5 font-medium">License #07458</div>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-scroll py-2 space-y-4" style={{ scrollbarWidth: 'none' }}>
          {nav.map(group => (
            <div key={group.group}>
              <div className="px-5 mb-1 text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em]">
                {group.group}
              </div>
              <div className="space-y-[2px]">
                {group.items.map(item => {
                  const active = item.href === '/inventory'
                    ? pathname === '/inventory'
                    : item.href === '/reports'
                    ? pathname === '/reports'
                    : pathname.startsWith(item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center px-5 py-2.5 text-xs font-semibold transition-colors duration-150 ${
                        active
                          ? 'bg-blue-50 text-blue-700 border-r-4 border-blue-600'
                          : 'text-slate-500 hover:text-blue-600 hover:bg-slate-50'
                      }`}
                    >
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User info */}
        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/50">
          <div className="text-slate-800 text-[11px] font-bold truncate mb-2">{user?.name}</div>
          <div className="flex items-center justify-between">
            <span className="text-[9px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-md font-bold uppercase tracking-wider">
              {user?.role}
            </span>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="text-[10px] text-slate-400 hover:text-red-500 font-bold transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}

