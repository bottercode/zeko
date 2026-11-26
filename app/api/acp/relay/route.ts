import { ACP_DEVICE_HEADER, googleAuthConfigured, workspaceId, WORKSPACE_HEADER } from '@/lib/auth-access'
import { eventStream } from '@/lib/server/events'
import { receiveAcpOutput, registerAcpDevice, type RelayCommand } from '@/lib/server/acp-relay'

function deviceOf(request: Request) {
  const workspace = request.headers.get(WORKSPACE_HEADER)
  const device = request.headers.get(ACP_DEVICE_HEADER)
  return googleAuthConfigured() && workspaceId(workspace) && workspaceId(device) ? { workspace, device } : undefined
}

export async function GET(request: Request) {
  const caller = deviceOf(request)
  if (!caller) return new Response(null, { status: 401 })
  const agents = (new URL(request.url).searchParams.get('agents') ?? '').split(',')
    .filter((agent): agent is 'claude' | 'codex' => agent === 'claude' || agent === 'codex')
  return eventStream<RelayCommand>(request.signal, () => ({ type: 'ready' }),
    (send) => registerAcpDevice(caller.workspace, caller.device, agents, send))
}

export async function POST(request: Request) {
  const caller = deviceOf(request)
  if (!caller) return new Response(null, { status: 401 })
  const input = await request.json().catch(() => null)
  if (typeof input?.id !== 'string' || !/^[a-f0-9-]{36}$/.test(input.id)) return new Response(null, { status: 400 })
  const { cwd, bytes, closed } = input
  if ((cwd !== undefined && (typeof cwd !== 'string' || cwd.length > 2048)) ||
      (bytes !== undefined && (typeof bytes !== 'string' || bytes.length > 512_000))) return new Response(null, { status: 400 })
  const found = receiveAcpOutput(caller.workspace, caller.device, { id: input.id, cwd, bytes, closed: closed === true })
  return new Response(null, { status: found ? 204 : 404 })
}
