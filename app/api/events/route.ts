import { connection } from 'next/server'
import { getBoard, markOpened, subscribe } from '@/lib/server/store'
import { canvasOf, noCanvas } from '@/lib/server/canvas'
import { eventStream } from '@/lib/server/events'

/** Server-sent events: the whole board after every change. */
export async function GET(request: Request) {
  await connection()
  const id = await canvasOf(request)
  if (!id) return noCanvas()
  // Watching a canvas makes it the one agents work on by default.
  markOpened(id)
  return eventStream(request.signal, () => getBoard(id), (send) => subscribe(id, send))
}
