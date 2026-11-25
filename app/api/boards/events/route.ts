import { connection } from 'next/server'
import { eventStream } from '@/lib/server/events'
import { agentPresences, prepareStore, subscribeAgents } from '@/lib/server/store'

export async function GET(request: Request) {
  await connection()
  await prepareStore()
  return eventStream(request.signal, agentPresences, subscribeAgents)
}
