import { connection } from 'next/server'
import { eventStream } from '@/lib/server/events'
import { agentPresences, subscribeAgents } from '@/lib/server/store'

export async function GET(request: Request) {
  await connection()
  return eventStream(request.signal, agentPresences, subscribeAgents)
}
