import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export default async function Home() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as { role?: string }
  redirect(user.role === 'STAFF' ? '/pos' : '/dashboard')
}
