import { connection } from 'next/server'
import { dispatch, flushCanvas, getBoard, replaceBoard, resetBoard, withWorkspace } from '@/lib/server/store'
import { canvasOf, noCanvas } from '@/lib/server/canvas'
import type { Board, Op } from '@/lib/types'
import { readDesign } from '@/lib/tokens'
import { readMemoryRules, readSketchComponents } from '@/lib/ops'
import { readCanvasSkills } from '@/lib/canvas-skills'
import { agentOrigin, startAgentRequest, stopAgentRequest } from '@/lib/server/agent-runner'

const HUMAN_OPS = new Set<Op['type']>([
  'board.update',
  'memory.rule.save',
  'memory.rule.remove',
  'memory.skill.save',
  'memory.skill.remove',
  'page.add',
  'page.rename',
  'page.remove',
  'page.moveFrames',
  'design.theme.add',
  'design.theme.select',
  'design.token.set',
  'design.token.remove',
  'component.save',
  'component.remove',
  'frame.create',
  'frame.update',
  'frame.delete',
  'frame.restoreVersion',
  'frame.variant',
  'deck.front',
  'deck.keep',
  'sheet.arrange',
  'comment.add',
  'comment.reply',
  'comment.resolve',
  'comment.delete',
  'task.add',
  'task.delete',
  'restore',
  'batch',
])

async function handleGet(request: Request) {
  await connection()
  const id = await canvasOf(request)
  if (!id) return noCanvas()
  return Response.json({ ...getBoard(id), id })
}

async function handlePost(request: Request) {
  const id = await canvasOf(request)
  if (!id) return noCanvas()
  const op = (await request.json().catch(() => null)) as Op | { type: 'task.start'; id: string } | { type: 'task.stop'; id: string } | null
  const origin = agentOrigin(request)
  if (op?.type === 'task.stop') {
    if (!origin) return Response.json({ error: 'Open the canvas to stop this reply.' }, { status: 403 })
    if (typeof op.id !== 'string' || !stopAgentRequest(id, op.id)) {
      return Response.json({ error: 'This reply has already stopped.' }, { status: 409 })
    }
    const { version } = getBoard(id)
    await flushCanvas(id)
    return Response.json({ version })
  }
  if (op?.type === 'task.start') {
    if (!origin) return Response.json({ error: 'Open the canvas to start this reply.' }, { status: 403 })
    if (typeof op.id !== 'string' || !startAgentRequest(id, op.id, origin)) {
      return Response.json({ error: 'This request is unavailable to start.' }, { status: 409 })
    }
    const { version } = getBoard(id)
    await flushCanvas(id)
    return Response.json({ version })
  }
  const allowed = (o: Op | null): boolean =>
    !!o && typeof o === 'object' && HUMAN_OPS.has(o.type) && (o.type !== 'batch' || (Array.isArray(o.ops) && o.ops.every((x) => x.type !== 'batch' && allowed(x))))
  if (!allowed(op) || !op) {
    return Response.json({ error: 'Unknown operation' }, { status: 400 })
  }
  const operations = op.type === 'batch' ? op.ops : [op]
  const existing = new Set(getBoard(id).tasks.map((task) => task.id))
  const { version } = dispatch(id, op, { kind: 'human', name: 'You' })
  await flushCanvas(id)
  if (origin) for (const item of operations) {
    if (item.type === 'task.add' && !existing.has(item.id)) {
      existing.add(item.id)
      startAgentRequest(id, item.id, origin)
    }
  }
  return Response.json({ version })
}

/** Puts the sample board back. */
async function handleDelete(request: Request) {
  const id = await canvasOf(request)
  if (!id) return noCanvas()
  const board = resetBoard(id)
  await flushCanvas(id)
  return Response.json({ version: board.version })
}

const isList = (v: unknown) => Array.isArray(v)
const isMap = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v)

/** Replaces the board with an exported one. Checks the shape, not every field. */
async function handlePut(request: Request) {
  const id = await canvasOf(request)
  if (!id) return noCanvas()
  const raw = (await request.json().catch(() => null)) as Partial<Board> | null
  const ok =
    !!raw &&
    typeof raw.name === 'string' &&
    isList(raw.frames) &&
    raw.frames!.every((f) => f && typeof f.id === 'string' && (f.kind === 'sketch' || f.kind === 'live' || f.kind === 'website') && [f.x, f.y, f.w, f.h].every((n) => typeof n === 'number')) &&
    isMap(raw.decks) &&
    isList(raw.comments) &&
    isList(raw.tasks)
  if (!ok) return Response.json({ error: 'That file is not a Zeko board.' }, { status: 400 })
  const board = replaceBoard(id, {
    name: raw!.name!,
    appUrl: typeof raw!.appUrl === 'string' ? raw!.appUrl : 'http://localhost:3000',
    pages: isList(raw!.pages) ? raw!.pages!.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string') : undefined,
    design: readDesign(raw!.design),
    components: readSketchComponents(raw!.components),
    flowStart: typeof raw!.flowStart === 'string' ? raw!.flowStart : undefined,
    guidelines: typeof raw!.guidelines === 'string' ? raw!.guidelines : undefined,
    memoryRules: readMemoryRules(raw!.memoryRules),
    skills: readCanvasSkills(raw!.skills),
    frames: raw!.frames!,
    decks: raw!.decks!,
    comments: raw!.comments!,
    tasks: raw!.tasks!,
    agents: {},
    lanes: isList(raw!.lanes) ? raw!.lanes! : [],
    activity: isList(raw!.activity) ? raw!.activity! : [],
    version: 0,
  })
  await flushCanvas(id)
  return Response.json({ version: board.version })
}

export const GET = withWorkspace(handleGet)
export const POST = withWorkspace(handlePost)
export const DELETE = withWorkspace(handleDelete)
export const PUT = withWorkspace(handlePut)
