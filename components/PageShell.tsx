import type { ReactNode } from "react"

type PageShellProps = {
  title: string
  subtitle?: string
  children?: ReactNode
}

export function PageShell({ title, subtitle, children }: PageShellProps): JSX.Element {
  return (
    <main className="min-h-screen p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-100">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
      </header>
      <section className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">{children}</section>
    </main>
  )
}
