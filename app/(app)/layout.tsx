import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"

import { Sidebar } from "@/components/Sidebar"
import { authOptions } from "@/lib/auth"
import { ensureDailyRollover } from "@/lib/rollover"

type AppLayoutProps = {
  children: React.ReactNode
}

export default async function AppLayout({ children }: AppLayoutProps): Promise<JSX.Element> {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id || !session.user.role) {
    redirect("/login")
  }

  // Rollover should not block requests. Failures are recovered by cron.
  void ensureDailyRollover().catch(() => undefined)

  return (
    <div className="flex min-h-screen bg-slate-950">
      <Sidebar name={session.user.name ?? "Staff"} role={session.user.role} />
      <div className="flex-1 overflow-x-hidden">{children}</div>
    </div>
  )
}
