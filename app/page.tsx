import { Suspense } from 'react'
import { connection } from 'next/server'
import { auth } from '@/auth'
import { Home } from '@/components/Home'
import { Button } from '@/components/ui/button'
import { googleAuthConfigured } from '@/lib/auth-access'
import { endSession } from './login/actions'

async function Account() {
  await connection()
  if (!googleAuthConfigured()) return null
  const session = await auth()
  if (!session?.user?.email) return null

  return (
    <form action={endSession} className="mt-3 flex flex-col items-start gap-1.5">
      <p className="max-w-full truncate text-xs text-muted-foreground" title={session.user.email}>{session.user.email}</p>
      <Button type="submit" variant="outline" size="sm">Sign out</Button>
    </form>
  )
}

export default function Page() {
  return <Home account={<Suspense fallback={null}><Account /></Suspense>} />
}
