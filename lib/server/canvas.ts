import 'server-only'
import { hasBoard, resolveId } from './store'

/** The canvas a request is about: ?board=ID, or the one opened last when it names none. Null when the named one doesn't exist. */
export function canvasOf(request: Request): string | null {
  const id = new URL(request.url).searchParams.get('board')
  if (id) return hasBoard(id) ? id : null
  return resolveId()
}

export const noCanvas = () => Response.json({ error: 'No such canvas.' }, { status: 404 })
