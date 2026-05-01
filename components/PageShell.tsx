import type { ReactNode } from "react"

type PageShellProps = {
  title: string
  subtitle?: string
  children?: ReactNode
}

export function PageShell({ title, subtitle, children }: PageShellProps): JSX.Element {
  return (
    <main className="min-h-screen bg-[#f8fafc] p-6 lg:p-10">
      <header className="mb-10 flex items-end justify-between border-b border-slate-200 pb-8">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">{title}</h1>
          {subtitle && (
            <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-500 uppercase tracking-wider">
              {subtitle}
            </p>
          )}
        </div>
      </header>
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {children}
      </section>
    </main>
  )
}
