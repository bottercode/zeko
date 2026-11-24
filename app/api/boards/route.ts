import { connection } from 'next/server'
import { nanoid } from 'nanoid'
import { createBoard, dispatch, knownAgents, listBoards, openSampleBoard } from '@/lib/server/store'
import type { Board } from '@/lib/types'
import { readDesign } from '@/lib/tokens'
import { readMemoryRules, readSketchComponents } from '@/lib/ops'
import { readCanvasSkills } from '@/lib/canvas-skills'
import { localAgentOrigin, startAgentRequest } from '@/lib/server/agent-runner'
import { readAcpSelection } from '@/lib/acp'

/** Every canvas, most recently edited first, and the agents seen on any of them. */
export async function GET() {
  await connection()
  return Response.json({ canvases: listBoards(), agents: knownAgents() })
}

interface CreateBody {
  name?: string
  sample?: boolean | 'open'
  /** a request to hand to agents as soon as the canvas exists */
  prompt?: string
  assignee?: string
  acp?: unknown
  /** an exported board to start from */
  board?: Board
}

const isList = (v: unknown) => Array.isArray(v)

/** Makes a canvas: empty, the sample, from an exported file, or from a request for agents. */
export async function POST(request: Request) {
  const body = ((await request.json().catch(() => null)) ?? {}) as CreateBody
  if (body.sample === 'open') return Response.json({ id: openSampleBoard() })
  let from: Board | undefined
  if (body.board) {
    const b = body.board
    const ok = typeof b.name === 'string' && isList(b.frames) && !!b.decks && isList(b.comments) && isList(b.tasks)
    if (!ok) return Response.json({ error: 'That file is not a Zeko board.' }, { status: 400 })
    from = { ...b, design: readDesign(b.design), components: readSketchComponents(b.components), memoryRules: readMemoryRules(b.memoryRules), skills: readCanvasSkills(b.skills), lanes: isList(b.lanes) ? b.lanes : [], activity: isList(b.activity) ? b.activity : [], agents: {} }
  }
  const prompt = body.prompt?.trim().slice(0, 4000)
  const name = body.name ?? (prompt ? nameFrom(prompt) : undefined)
  const id = createBoard({ name, sample: body.sample, from })
  if (prompt) {
    const taskId = nanoid(10)
    dispatch(id, { type: 'task.add', id: taskId, text: prompt, frameIds: [], assignee: body.assignee?.slice(0, 40) || undefined, acp: readAcpSelection(body.acp) }, { kind: 'human', name: 'You' })
    const origin = localAgentOrigin(request)
    if (origin) startAgentRequest(id, taskId, origin)
  }
  return Response.json({ id }, { status: 201 })
}

/** A short canvas name from the first words of a request. */
function nameFrom(prompt: string) {
  const words = prompt.replace(/\s+/g, ' ').split(' ').slice(0, 6).join(' ')
  const name = words.length > 40 ? `${words.slice(0, 40).trimEnd()}…` : words
  return name.charAt(0).toUpperCase() + name.slice(1)
}
