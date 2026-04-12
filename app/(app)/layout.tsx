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
      { href: '/sales', label: 'Sales History' },
    ],
  },
  {
    group: 'Inventory',
    items: [
      { href: '/inventory', label: 'Stock Overview' },
      { href: '/close-day', label: '📦 Close Day' },
      { href: '/inventory/opening', label: 'Opening Stock' },
      { href: '/inventory/closing', label: 'Closing Stock' },
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
      { href: '/attendance', label: 'Biometric Attendance' },
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
      { href: '/attendance', label: 'Biometric Attendance' },
      { href: '/cash', label: 'Cash Register' },
      { href: '/expenses', label: 'Expenditure' },
    ],
  },
  {
    group: 'Inventory',
    items: [
      { href: '/inventory', label: 'Stock Overview' },
      { href: '/close-day', label: '📦 Close Day' },
      { href: '/indents', label: 'Indents (KSBCL)' },
    ],
  },
]

// Staff can access POS, cash register, expenses, and inventory
const STAFF_ALLOWED = ['/pos', '/cash', '/expenses', '/inventory', '/close-day', '/indents', '/attendance']

// ── Layout ────────────────────────────────────────────────────────────────────

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const router = useRouter()
  const pathname = usePathname()

  const user = session?.user as { id?: string; name?: string; role?: string } | undefined
  const isAdmin = user?.role === 'ADMIN'
  const isStaff = user?.role === 'STAFF'

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
    <div className="flex h-screen bg-slate-100 overflow-hidden">
      {/* ── Sidebar ────────────────────────────────────────────────────── */}
      <aside className="w-48 bg-slate-900 flex flex-col flex-shrink-0">
        {/* Brand */}
        <div className="px-3 py-3 border-b border-slate-800">
          <div className="text-white font-bold text-xs leading-tight">Mahavishnu Wines</div>
          <div className="text-slate-500 text-[10px] mt-0.5">License #07458</div>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-scroll py-2 space-y-3" style={{ scrollbarWidth: 'thin', scrollbarColor: '#334155 transparent' }}>
          {nav.map(group => (
            <div key={group.group}>
              <div className="px-3 mb-0.5 text-[9px] font-bold text-slate-600 uppercase tracking-widest">
                {group.group}
              </div>
              {group.items.map(item => {
                const active = item.href === '/inventory'
                  ? pathname === '/inventory'
                  : pathname.startsWith(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    {item.label}
                    {item.href === '/alerts' && <AlertBadge />}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        {/* User info */}
        <div className="px-3 py-2.5 border-t border-slate-800">
          <div className="text-white text-[11px] font-semibold truncate mb-1">{user?.name}</div>
          <div className="flex items-center justify-between">
            <span className="text-[9px] px-1.5 py-0.5 bg-amber-500 text-amber-900 rounded font-bold uppercase">
              {user?.role}
            </span>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="text-[10px] text-slate-500 hover:text-white transition-colors"
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

// ── Alert badge (shows count of unresolved HIGH variances) ────────────────────

function AlertBadge() {
  // Keep simple — just a static indicator for now
  // Could fetch count via SWR in a real implementation
  return null
}
