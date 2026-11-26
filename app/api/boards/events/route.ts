import { connection } from 'next/server'
import { eventStream } from '@/lib/server/events'
import { agentPresences, canvasListRevision, prepareStore, subscribeAgents, subscribeCanvasList, withWorkspace } from '@/lib/server/store'

async function handleGet(request: Request) {
  await connection()
  await prepareStore()
  if (new URL(request.url).searchParams.get('canvases') === '1') {
    let agents = agentPresences()
    const read = () => ({ agents, revision: canvasListRevision() })
    return eventStream(request.signal, read, (send) => {
      const stopAgents = subscribeAgents((next) => { agents = next; send(read()) })
      const stopCanvases = subscribeCanvasList(() => send(read()))
      return () => { stopAgents(); stopCanvases() }
    })
  }
  return eventStream(request.signal, agentPresences, subscribeAgents)
}

export const GET = withWorkspace(handleGet)
