import { connection } from 'next/server'
import { readAcpSelection, type AcpCapabilities, type AcpSelection } from '@/lib/acp'
import { AcpSessionError, listAcpAgents, withAcpSession } from '@/lib/server/acp-session'
import { localAgentOrigin } from '@/lib/server/agent-runner'

type OptionCache = { data?: AcpCapabilities; at?: number; pending?: Promise<AcpCapabilities> }
const runtime = globalThis as typeof globalThis & { __zekoAcpOptions?: Map<string, OptionCache> }
const cache = runtime.__zekoAcpOptions ??= new Map<string, OptionCache>()
const keyOf = ({ agent, settings }: AcpSelection) => JSON.stringify([agent, Object.entries(settings).sort()])
const base = (agent: AcpSelection['agent']): AcpSelection => ({ agent, settings: {} })

function optionsFor(selection: AcpSelection, refresh = false): Promise<AcpCapabilities> {
  const key = keyOf(selection)
  const existing = cache.get(key)
  if (existing?.pending) return existing.pending
  if (!refresh && existing?.data && Date.now() - (existing.at ?? 0) < 10 * 60_000) return Promise.resolve(existing.data)

  const entry = existing ?? {}
  entry.pending = withAcpSession(selection.agent, selection.settings, AbortSignal.timeout(25_000), async (session) => session.capabilities())
    .then((data) => {
      entry.data = data
      entry.at = Date.now()
      return data
    }).finally(() => { entry.pending = undefined })
  if (!existing && cache.size >= 48) {
    const oldest = [...cache].find(([, item]) => !item.pending)
    if (oldest) cache.delete(oldest[0])
  }
  cache.set(key, entry)
  return entry.pending
}

export async function GET(request: Request) {
  await connection()
  const agents = listAcpAgents()
  const catalog = Object.fromEntries(agents.flatMap(({ id }) => {
    const entry = cache.get(keyOf(base(id)))
    return entry?.data ? [[id, entry.data.options]] : []
  }))
  if (request.headers.get('sec-fetch-site') !== 'cross-site') {
    for (const agent of agents) {
      if (agent.available && (agent.id === 'codex' || agent.id === 'claude')) void optionsFor(base(agent.id)).catch(() => {})
    }
  }
  return Response.json({ agents, catalog })
}

export async function POST(request: Request) {
  if (!localAgentOrigin(request)) return Response.json({ error: 'Open Zeko on localhost to use ACP.' }, { status: 403 })
  const body = await request.json().catch(() => null)
  const selection = readAcpSelection(body)
  if (!selection) return Response.json({ error: 'Choose an ACP agent.' }, { status: 400 })
  try {
    return Response.json(await optionsFor(selection, body?.refresh === true))
  } catch (error) {
    const message = error instanceof AcpSessionError ? error.message : 'The ACP agent did not respond.'
    return Response.json({ error: message }, { status: 502 })
  }
}
