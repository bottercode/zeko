import { Suspense } from 'react'
import { connection } from 'next/server'
import { auth } from '@/auth'
import { Home } from '@/components/Home'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'
import { googleAuthConfigured } from '@/lib/auth-access'
import { endSession } from './login/actions'

async function Account() {
  await connection()
  if (!googleAuthConfigured()) return null
  const session = await auth()
  if (!session?.user?.email) return null

  const { name, email } = session.user
  const displayName = name || email
  const initials = displayName.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase()
  return (
    <form action={endSession} className="flex min-w-0 items-center gap-2.5 border-t border-border p-3">
      <Avatar aria-hidden><AvatarFallback>{initials}</AvatarFallback></Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={displayName}>{displayName}</p>
        {name && <p className="truncate text-xs text-muted-foreground" title={email}>{email}</p>}
      </div>
      <Button type="submit" aria-label="Sign out" title="Sign out" variant="ghost" size="icon-sm"><LogOut aria-hidden /></Button>
    </form>
  )
}

export default function Page() {
  return <Home account={<Suspense fallback={null}><Account /></Suspense>} />
}
