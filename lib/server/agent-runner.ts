import 'server-only'
import { createUIMessageStream, readUIMessageStream } from 'ai'
import { nanoid } from 'nanoid'
import { encode } from 'next-auth/jwt'
import { ACP_RUN_TOKEN_SALT } from '../auth-access'
import { DESIGN_BRIEF, designContext } from '../design-brief'
import { acpAgent, readAcpSelection, type AcpToolActivity } from '../acp'
import { DEFAULT_CHAT_ID, localAgentProvider } from '../ops'
import type { Actor, Task } from '../types'
import { AcpSessionError, withAcpSession } from './acp-session'
import { currentWorkspace, dispatch, getBoard, hasBoard } from './store'

const UPDATE_INTERVAL = 50
const runtime = globalThis as typeof globalThis & { __zekoAcpRuns?: Map<string, AbortController> }
const runs = runtime.__zekoAcpRuns ??= new Map<string, AbortController>()
const runKey = (boardId: string, taskId: string) => `${currentWorkspace() ?? 'local'}:${boardId}:${taskId}`

/** Browser actions that launch a local process come from Zeko's loopback origin. */
export function localAgentOrigin(request: Request): string | undefined {
  if (process.env.ZEKO_HOSTED === '1') return undefined
  const origin = request.headers.get('origin')
  if (!origin) return undefined
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' || url.origin !== origin || !url.port || url.host !== request.headers.get('host')) return undefined
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return undefined
    return `http://127.0.0.1:${url.port}`
  } catch {
    return undefined
  }
}

export function agentOrigin(request: Request) {
  if (currentWorkspace()) {
    const origin = process.env.AUTH_URL
    return origin && request.headers.get('origin') === new URL(origin).origin ? origin : undefined
  }
  return localAgentOrigin(request)
}

export function stopAgentRequest(boardId: string, taskId: string) {
  const controller = runs.get(runKey(boardId, taskId))
  if (!controller || controller.signal.aborted) return false
  controller.abort(new AcpSessionError('You stopped this reply.'))
  return true
}

function selectionFor(task: Task) {
  const local = localAgentProvider(task.assignee)
  return readAcpSelection(task.acp) ?? (local ? { agent: local, settings: {} } : undefined)
}

/** Reserve the request before starting an ACP session so duplicate sends cannot start it twice. */
export function startAgentRequest(boardId: string, taskId: string, origin: string): boolean {
  const task = getBoard(boardId).tasks.find((item) => item.id === taskId)
  if (!task?.assignee || task.status !== 'open' || typeof task.text !== 'string' || !task.text.trim() || (task.localRun && !task.localRun.error)) return false
  const selection = selectionFor(task)
  if (!selection) return false
  const actor: Actor = { kind: 'agent', name: task.assignee }
  const runId = nanoid(24)
  const controller = new AbortController()
  const key = runKey(boardId, taskId)
  runs.set(key, controller)
  dispatch(boardId, { type: 'task.run.start', id: taskId, runId }, actor)
  void runAgent(boardId, task, origin, actor, runId, selection, controller).finally(() => {
    if (runs.get(key) === controller) runs.delete(key)
  })
  return true
}

async function runAgent(
  boardId: string, task: Task, origin: string, actor: Actor, runId: string,
  selection: NonNullable<ReturnType<typeof selectionFor>>, controller: AbortController,
) {
  const taskId = task.id
  const current = () => hasBoard(boardId) ? getBoard(boardId).tasks.find((item) => item.id === taskId && item.localRun?.id === runId) : undefined
  const url = new URL('/api/mcp', origin)
  url.search = new URLSearchParams({ board: boardId, as: actor.name, task: taskId, run: runId }).toString()
  const board = getBoard(boardId)
  const history = board.tasks
    .filter((item) => item.id !== taskId && item.at <= task.at && item.status === 'done' && (item.chatId ?? DEFAULT_CHAT_ID) === (task.chatId ?? DEFAULT_CHAT_ID))
    .sort((a, b) => b.at - a.at)
    .slice(0, 8)
    .reverse()
    .map((item) => ({ message: item.text.slice(0, 1_200), reply: (item.reply || item.summary)?.slice(0, 1_800), frames: item.resultFrameIds?.slice(0, 8) }))
  const prompt = [
    `You are working on Zeko canvas ${JSON.stringify(boardId)}, request ${JSON.stringify(taskId)}.`,
    'Answer questions directly. Start canvas work with the context below. Call get_board when you need other frames, the full guidelines or token set, or updated canvas state. Use the page ID below for new sketches. Call complete_task with the actual result frame IDs and finish with a brief reply.',
    'For design work, read get_guide with topic "design" first. If the request names a canvas skill or clearly matches a skill description, also read it with get_skill before designing.',
    'For specific text, style, and layout edits, use get_layers and edit_layers. Batch related layer changes with the revision from get_layers and verify the result on the canvas.',
    'For a design, call set_status when you start. Publish the first meaningful section with create_sketch (streaming: true and a <!-- zeko:stream --> marker). Send each next section with append_to_sketch, before that marker, and set done: true on the last one. Put the first version on the canvas before sourcing images or polishing. Do not use shell commands or edit workspace files.',
    DESIGN_BRIEF,
    `Canvas context (read-only snapshot for this request):\n${JSON.stringify(designContext(board, task))}`,
    task.element ? `Selected element: ${JSON.stringify(task.element)}.` : '',
    history.length ? `Earlier chat turns for context: ${JSON.stringify(history)}.` : '',
    `Current request:\n${task.text}`,
  ].filter(Boolean).join('\n\n')
  const signal = controller.signal
  const timeout = setTimeout(() => controller.abort(new AcpSessionError('The agent reached its time limit.')), 10 * 60_000)
  timeout.unref()
  const tools = new Map<string, AcpToolActivity>()
  let reply = ''
  let thinking = ''
  let stopReason: string | undefined
  let errorMessage: string | undefined
  let updateTimer: ReturnType<typeof setTimeout> | undefined
  const publish = () => {
    clearTimeout(updateTimer)
    updateTimer = undefined
    const item = current()
    if (!item || item.localRun?.error) return
    dispatch(boardId, { type: 'task.run.stream', id: taskId, runId, reply, thinking, tools: [...tools.values()] }, actor)
  }
  const schedule = () => { updateTimer ??= setTimeout(publish, UPDATE_INTERVAL) }
  const limit = { text: 16_000, reasoning: 4_000 }
  const lengths = { text: 0, reasoning: 0 }

  try {
    const workspace = currentWorkspace()
    const mcpToken = workspace ? await encode({
      secret: process.env.AUTH_SECRET!,
      salt: ACP_RUN_TOKEN_SALT,
      maxAge: 11 * 60,
      token: { workspace, board: boardId, task: taskId, run: runId, as: actor.name },
    }) : undefined
    const stream = createUIMessageStream({
      onError: (error) => {
        const reason = signal.aborted ? signal.reason : error
        errorMessage = reason instanceof AcpSessionError ? reason.message : 'The ACP agent stopped unexpectedly.'
        return errorMessage
      },
      execute: async ({ writer }) => {
        let active: { kind: 'text' | 'reasoning'; id: string; messageId?: string | null } | undefined
        let part = 0
        const end = () => {
          if (!active) return
          writer.write({ type: active.kind === 'text' ? 'text-end' : 'reasoning-end', id: active.id })
          active = undefined
        }
        try {
          const result = await withAcpSession(selection.agent, selection.settings, signal, (session) => session.prompt(prompt), {
            mcpUrl: url,
            mcpToken,
            onReady: () => { if (current()) dispatch(boardId, { type: 'task.claim', id: taskId }, actor) },
            update: (update) => {
              if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
                const id = update.toolCallId
                const previous = tools.get(id)
                if (!previous && tools.size >= 24) return
                end()
                tools.set(id, {
                  id,
                  title: update.title?.slice(0, 120) || previous?.title || 'Using a tool',
                  status: update.status ?? previous?.status ?? 'pending',
                })
                schedule()
                return
              }
              if (update.sessionUpdate !== 'agent_message_chunk' && update.sessionUpdate !== 'agent_thought_chunk') return
              if (update.content.type !== 'text') return
              const kind = update.sessionUpdate === 'agent_message_chunk' ? 'text' : 'reasoning'
              const delta = update.content.text.slice(0, limit[kind] - lengths[kind])
              if (!delta) return
              lengths[kind] += delta.length
              if (active?.kind !== kind || active.messageId !== update.messageId) {
                end()
                active = { kind, id: String(++part), messageId: update.messageId }
                writer.write({ type: kind === 'text' ? 'text-start' : 'reasoning-start', id: active.id })
              }
              writer.write({ type: kind === 'text' ? 'text-delta' : 'reasoning-delta', id: active.id, delta })
            },
          })
          stopReason = result.stopReason
        } finally {
          end()
        }
      },
    })
    for await (const message of readUIMessageStream({ stream, onError: () => {} })) {
      reply = message.parts.flatMap((part) => part.type === 'text' ? [part.text] : []).filter(Boolean).join('\n\n')
      thinking = message.parts.flatMap((part) => part.type === 'reasoning' ? [part.text] : []).filter(Boolean).join('\n\n')
      schedule()
    }
    publish()
    const item = current()
    if (!item) return
    if (item.status === 'done') {
      dispatch(boardId, { type: 'task.run.close', id: taskId, runId }, actor)
      return
    }
    if (!errorMessage && stopReason === 'end_turn' && reply.trim()) {
      dispatch(boardId, { type: 'task.complete', id: taskId, resultFrameIds: [] }, actor)
      dispatch(boardId, { type: 'task.run.close', id: taskId, runId }, actor)
      return
    }
    errorMessage ??= stopReason === 'cancelled' ? 'You stopped this reply.' : 'The agent ended before finishing its reply.'
  } catch {
    errorMessage ??= `${acpAgent(selection.agent)?.name ?? actor.name} couldn’t finish this reply.`
  } finally {
    clearTimeout(timeout)
    clearTimeout(updateTimer)
    const item = current()
    if (errorMessage && item && item.status !== 'done') {
      dispatch(boardId, { type: 'task.run.fail', id: taskId, runId, error: errorMessage }, actor)
    }
    if (hasBoard(boardId) && !getBoard(boardId).tasks.some((item) => item.status === 'claimed' && item.claimedBy === actor.name)) {
      dispatch(boardId, { type: 'agent.status', working: false, message: 'Finished' }, actor)
    }
  }
}
