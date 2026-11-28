import { Suspense } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { googleAuthConfigured, USER_HEADER, workspaceId } from '@/lib/auth-access'
import { inviteDetails, teamRole } from '@/lib/server/teams'
import { acceptInviteAction } from '@/app/teams/actions'

async function join(form: FormData) {
  'use server'
  const result = await acceptInviteAction(String(form.get('token') ?? ''))
  redirect(result.ok ? '/' : `/join/${encodeURIComponent(String(form.get('token') ?? ''))}?failed=1`)
}

async function Invite({ params, searchParams }: PageProps<'/join/[token]'>) {
  // Invites are checked against the clock and the signed-in person, so this page renders at request time.
  await connection()
  if (!googleAuthConfigured()) redirect('/')
  const [{ token }, { failed }] = await Promise.all([params, searchParams])
  const invite = await inviteDetails(token)
  const user = (await headers()).get(USER_HEADER)
  const member = invite && workspaceId(user) ? await teamRole(user, invite.teamId) : null
  return (
    <section className="panel flex w-full max-w-md flex-col gap-5 rounded-xl p-6 sm:p-8">
      <span className="grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground" aria-hidden><Users size={20} /></span>
      {invite ? (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-semibold text-foreground">Join {invite.name}</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {member
                ? 'You’re already in this team. Open it to see its canvases.'
                : 'You’ve been invited to this team on Zeko. Members can open and edit its canvases and connect agents to them.'}
            </p>
            {failed && <p className="text-sm text-destructive">That didn’t work. The link may have just been reset; ask for a new one.</p>}
          </div>
          <form action={join} className="flex justify-end gap-2">
            <input type="hidden" name="token" value={token} />
            <Button type="submit">{member ? 'Open team' : 'Join team'}</Button>
          </form>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold text-foreground">This invite has expired</h1>
          <p className="text-sm text-muted-foreground">Invite links last 7 days, and making a new one turns off the old one. Ask a team owner for a fresh link.</p>
        </div>
      )}
    </section>
  )
}

export default function Page(props: PageProps<'/join/[token]'>) {
  return <main className="grid min-h-dvh place-items-center px-4 py-8"><Suspense fallback={null}><Invite {...props} /></Suspense></main>
}
