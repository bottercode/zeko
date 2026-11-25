import { connection } from 'next/server'
import { eventStream } from '@/lib/server/events'
import { connectCompanion, prepareStore } from '@/lib/server/store'

export async function GET(request: Request) {
  await connection()
  const host = request.headers.get('host') ?? ''
  if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host) || request.headers.has('origin') || request.headers.has('sec-fetch-site')) {
    return Response.json({ error: 'Connect the Zeko CLI on localhost.' }, { status: 403 })
  }
  const provider = new URL(request.url).searchParams.get('provider') ?? 'codex'
  if (provider !== 'codex' && provider !== 'claude') return Response.json({ error: 'Unknown provider.' }, { status: 400 })
  const agent = provider === 'claude' ? 'Claude' : 'Codex'
  await prepareStore()
  return eventStream(request.signal, () => ({ agent, connected: true }), () => connectCompanion(agent))
}
