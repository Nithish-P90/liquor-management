import type { ReactNode } from "react"

type PageShellProps = {
  title: string
  subtitle?: string
  children?: ReactNode
}

export function PageShell({ title, subtitle, children }: PageShellProps): JSX.Element {
  return (
    <main className="min-h-screen bg-[#f8fafc] p-4 lg:p-6">
      <header className="mb-5 flex items-end justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">{title}</h1>
          {subtitle && (
            <p className="mt-1 flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {subtitle}
            </p>
          )}
        </div>
      </header>
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {children}
      </section>
    </main>
  )
}
