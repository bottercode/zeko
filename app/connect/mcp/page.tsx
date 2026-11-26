import { Suspense } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Plug } from 'lucide-react'
import { auth } from '@/auth'
import { Button } from '@/components/ui/button'
import { workspaceId, WORKSPACE_HEADER } from '@/lib/auth-access'
import { finishMcpConsent, mcpConsent } from '@/lib/server/mcp-oauth'

async function decide(form: FormData) {
  'use server'
  const workspace = (await headers()).get(WORKSPACE_HEADER)
  const consent = await mcpConsent(form.get('request'))
  if (!workspaceId(workspace) || !consent) redirect('/connect/mcp')
  redirect(await finishMcpConsent(consent, workspace, form.get('decision') === 'approve'))
}

async function Permission({ searchParams }: Pick<PageProps<'/connect/mcp'>, 'searchParams'>) {
  const { request } = await searchParams
  const consent = await mcpConsent(request)
  const session = consent ? await auth() : null
  return (
    <section className="panel flex w-full max-w-md flex-col gap-5 rounded-xl p-6 sm:p-8">
      <span className="grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground" aria-hidden><Plug size={20} /></span>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-foreground">Connect an MCP client</h1>
        {consent && session?.user?.email ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Allow the app that opened this page to view and edit canvases in your Zeko workspace.
            You’re signed in as <strong className="break-all font-medium text-foreground">{session.user.email}</strong>.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">This connection request has expired. Start sign-in again from your MCP client.</p>
        )}
      </div>
      {consent && session?.user?.email && (
        <form action={decide} className="flex flex-wrap justify-end gap-2">
          <input type="hidden" name="request" value={request as string} />
          <Button name="decision" value="deny" type="submit" variant="outline">Cancel</Button>
          <Button name="decision" value="approve" type="submit">Allow access</Button>
        </form>
      )}
    </section>
  )
}

export default function Page({ searchParams }: PageProps<'/connect/mcp'>) {
  return <main className="grid min-h-dvh place-items-center px-4 py-8"><Suspense fallback={null}><Permission searchParams={searchParams} /></Suspense></main>
}
