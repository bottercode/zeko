import { connection } from 'next/server'
import { acpDeviceStatus, subscribeAcpDevices } from '@/lib/server/acp-relay'
import { listAcpAgents } from '@/lib/server/acp-session'
import { eventStream } from '@/lib/server/events'
import { currentWorkspace, withWorkspace } from '@/lib/server/store'

export const GET = withWorkspace(async (request: Request) => {
  await connection()
  const workspace = currentWorkspace()
  const hosted = process.env.ZEKO_HOSTED === '1'
  const read = () => ({ hosted, connected: acpDeviceStatus(workspace).connected, agents: listAcpAgents(workspace) })
  return eventStream(request.signal, read, (send) =>
    workspace ? subscribeAcpDevices(workspace, () => send(read())) : () => {})
})
