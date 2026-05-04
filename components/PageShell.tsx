import type { ReactNode } from "react"

type PageShellProps = {
  title: string
  subtitle?: string
  children?: ReactNode
}

export function PageShell({ title, subtitle, children }: PageShellProps): JSX.Element {
  return (
    <main className="min-h-screen bg-[#f8fafc] p-5 lg:p-8">
      <header className="mb-6 flex items-end justify-between border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{title}</h1>
          {subtitle && (
            <p className="mt-1.5 flex items-center gap-2 text-sm font-semibold text-slate-600 uppercase tracking-[0.18em]">
              {subtitle}
            </p>
          )}
        </div>
      </header>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm animate-soft-fade-in">
        {children}
      </section>
    </main>
  )
}
