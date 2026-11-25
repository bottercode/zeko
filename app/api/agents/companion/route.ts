import { connection } from 'next/server'
import { eventStream } from '@/lib/server/events'
import { googleAuthConfigured } from '@/lib/auth-access'
import { connectCompanion, prepareStore, withWorkspace } from '@/lib/server/store'

export const GET = withWorkspace(async (request: Request) => {
  await connection()
  const host = request.headers.get('host') ?? ''
  if (!googleAuthConfigured() && (process.env.ZEKO_HOSTED === '1' || !/^(?:127\.0\.0\.1|localhost):\d+$/.test(host) || request.headers.has('origin') || request.headers.has('sec-fetch-site'))) {
    return Response.json({ error: 'Connect the Zeko CLI to a local canvas or sign in to a hosted workspace.' }, { status: 403 })
  }
  const provider = new URL(request.url).searchParams.get('provider') ?? 'codex'
  if (provider !== 'codex' && provider !== 'claude') return Response.json({ error: 'Unknown provider.' }, { status: 400 })
  const agent = provider === 'claude' ? 'Claude' : 'Codex'
  await prepareStore()
  return eventStream(request.signal, () => ({ agent, connected: true }), () => connectCompanion(agent))
})
