import { connection } from 'next/server'
import { nanoid } from 'nanoid'
import { createBoard, dispatch, flushCanvas, knownAgents, listBoards, openSampleBoard, prepareStore, storageMode, withWorkspace, workspaceStarted } from '@/lib/server/store'
import { readBoardImport } from '@/lib/server/board-import'
import { agentOrigin, startAgentRequest } from '@/lib/server/agent-runner'
import { readAcpSelection } from '@/lib/acp'

/** Every canvas, most recently edited first, and the agents seen on any of them. */
async function handleGet(_request: Request) {
  await connection()
  await prepareStore()
  return Response.json({
    canvases: listBoards(),
    agents: knownAgents(),
    storage: storageMode,
    hosted: process.env.ZEKO_HOSTED === '1',
    started: workspaceStarted(),
  })
}

interface CreateBody {
  name?: string
  sample?: boolean | 'open'
  /** a request to hand to agents as soon as the canvas exists */
  prompt?: string
  assignee?: string
  acp?: unknown
  /** an exported board to start from */
  board?: unknown
}

/** Makes a canvas: empty, the sample, from an exported file, or from a request for agents. */
async function handlePost(request: Request) {
  await prepareStore()
  const body = await request.json().catch(() => null) as CreateBody | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Invalid canvas request.' }, { status: 400 })
  if (body.sample === 'open') {
    const id = openSampleBoard()
    await flushCanvas(id)
    return Response.json({ id })
  }
  const from = readBoardImport(body.board)
  if (body.board !== undefined && !from) return Response.json({ error: 'That file is not a valid Zeko canvas export.' }, { status: 400 })
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 4000) : undefined
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : prompt ? nameFrom(prompt) : undefined
  const id = createBoard({ name, sample: body.sample === true, from })
  const taskId = prompt ? nanoid(10) : undefined
  if (prompt && taskId) {
    const assignee = typeof body.assignee === 'string' ? body.assignee.slice(0, 40) : undefined
    dispatch(id, { type: 'task.add', id: taskId, text: prompt, frameIds: [], assignee, acp: readAcpSelection(body.acp) }, { kind: 'human', name: 'You' })
  }
  await flushCanvas(id)
  const origin = taskId && agentOrigin(request)
  if (taskId && origin) startAgentRequest(id, taskId, origin)
  return Response.json({ id }, { status: 201 })
}

/** A short canvas name from the first words of a request. */
function nameFrom(prompt: string) {
  const words = prompt.replace(/\s+/g, ' ').split(' ').slice(0, 6).join(' ')
  const name = words.length > 40 ? `${words.slice(0, 40).trimEnd()}…` : words
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export const GET = withWorkspace(handleGet)
export const POST = withWorkspace(handlePost)
