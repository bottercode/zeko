import { ACP_DEVICE_HEADER, googleAuthConfigured, workspaceId } from '@/lib/auth-access'
import { requestMember } from '@/lib/server/teams'
import { ACP_AGENTS } from '@/lib/acp'
import { eventStream } from '@/lib/server/events'
import { receiveAcpOutput, registerAcpDevice, type RelayCommand } from '@/lib/server/acp-relay'

/** A paired CLI, while the person who paired it is still in the team. */
async function deviceOf(request: Request) {
  const device = request.headers.get(ACP_DEVICE_HEADER)
  if (!googleAuthConfigured() || !workspaceId(device)) return
  const member = await requestMember(request.headers)
  return member ? { workspace: member.team, device } : undefined
}

export async function GET(request: Request) {
  const caller = await deviceOf(request)
  if (!caller) return new Response(null, { status: 401 })
  const advertised = new Set((new URL(request.url).searchParams.get('agents') ?? '').split(','))
  const agents = ACP_AGENTS.filter(({ id }) => advertised.has(id)).map(({ id }) => id)
  return eventStream<RelayCommand>(request.signal, () => ({ type: 'ready' }),
    (send) => registerAcpDevice(caller.workspace, caller.device, agents, send), 'ordered')
}

export async function POST(request: Request) {
  const caller = await deviceOf(request)
  if (!caller) return new Response(null, { status: 401 })
  const input = await request.json().catch(() => null)
  if (typeof input?.id !== 'string' || !/^[a-f0-9-]{36}$/.test(input.id)) return new Response(null, { status: 400 })
  const { cwd, bytes, closed } = input
  if ((cwd !== undefined && (typeof cwd !== 'string' || cwd.length > 2048)) ||
      (bytes !== undefined && (typeof bytes !== 'string' || bytes.length > 512_000))) return new Response(null, { status: 400 })
  const found = receiveAcpOutput(caller.workspace, caller.device, { id: input.id, cwd, bytes, closed: closed === true })
  return new Response(null, { status: found ? 204 : 404 })
}
