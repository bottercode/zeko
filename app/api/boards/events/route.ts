import { connection } from 'next/server'
import { eventStream } from '@/lib/server/events'
import { agentPresences, prepareStore, subscribeAgents, withWorkspace } from '@/lib/server/store'

async function handleGet(request: Request) {
  await connection()
  await prepareStore()
  return eventStream(request.signal, agentPresences, subscribeAgents)
}

export const GET = withWorkspace(handleGet)
