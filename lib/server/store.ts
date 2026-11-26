import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { databaseUrl, workspaceDatabase } from '../db/connection'
import { accountCanvases, mcpOAuthGrants, oauthAccounts, users } from '../db/schema'
import { googleAuthConfigured, workspaceId, WORKSPACE_HEADER } from '../auth-access'
import { AGENT_AWAY_MS, applyOp, deckFront, emptyBoard, upgradeSheetLabels, visibleFrames } from '../ops'
import { addSamplePrototype, SAMPLE_ID, seedBoard } from '../seed'
import { withDesignTokens } from '../tokens'
import type { Actor, AgentPresence, Board, Op } from '../types'
import { CanvasWriteConflict, databasePersistence } from './database'

type Listener = (board: Board) => void
type SeenAgent = Pick<AgentPresence, 'name' | 'lastSeen' | 'connectedAt' | 'mcpConnectedAt' | 'companion'> & { canvas: string }

interface Entry {
  board: Board
  listeners: Set<Listener>
  saveTimer?: ReturnType<typeof setTimeout>
  samplePrototypeChecked?: boolean
}

interface StoreState {
  entries: Map<string, Entry>
  ownerId?: string
  agentListeners: Set<(agents: SeenAgent[]) => void>
  companions: Map<string, { connectedAt: number; clients: number }>
  /** the canvas someone opened last; agents that don't name a canvas work here */
  lastOpened?: string
  database?: ReturnType<typeof databasePersistence>
  ready?: Promise<void>
}

const DATA_DIR = join(process.cwd(), '.zeko')
const BOARDS_DIR = join(DATA_DIR, 'boards')
const TRASH_DIR = join(DATA_DIR, 'trash')
const META_FILE = join(DATA_DIR, 'meta.json')
/** The single-board file from before canvases existed. */
const LEGACY_FILE = join(DATA_DIR, 'board.json')

const validId = (id: string) => /^[\w-]{1,40}$/.test(id)

function writeAtomic(file: string, data: string) {
  mkdirSync(join(file, '..'), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, data)
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

function stamp(board: Board): Board {
  const now = Date.now()
  return upgradeSheetLabels({ ...board, createdAt: board.createdAt ?? now, updatedAt: board.updatedAt ?? now })
}

function recoverRuns(board: Board): Board {
  for (const task of board.tasks) {
    if (!task?.localRun || task.localRun.error) continue
    if (task.status === 'done') {
      task.localRun = undefined
      continue
    }
    task.status = 'open'
    task.claimedBy = undefined
    task.localRun.error = 'Zeko restarted before the agent finished.'
  }
  return board
}

function load(): Pick<StoreState, 'entries' | 'lastOpened'> {
  const entries = new Map<string, Entry>()
  if (existsSync(BOARDS_DIR)) {
    for (const file of readdirSync(BOARDS_DIR)) {
      if (!file.endsWith('.json')) continue
      try {
        entries.set(file.slice(0, -5), { board: stamp(recoverRuns(JSON.parse(readFileSync(join(BOARDS_DIR, file), 'utf8')) as Board)), listeners: new Set() })
      } catch {
        // A file that doesn't parse is left on disk for the person to look at.
      }
    }
  }
  if (entries.size === 0) {
    // First run, or a board saved before canvases: it becomes the first canvas.
    let first: Board
    try {
      first = JSON.parse(readFileSync(LEGACY_FILE, 'utf8')) as Board
    } catch {
      first = seedBoard()
    }
    entries.set(SAMPLE_ID, { board: stamp(recoverRuns(first)), listeners: new Set() })
    writeAtomic(join(BOARDS_DIR, `${SAMPLE_ID}.json`), JSON.stringify(entries.get(SAMPLE_ID)!.board))
  }
  return { entries, lastOpened: readLastOpened() }
}

function readLastOpened() {
  try {
    return (JSON.parse(readFileSync(META_FILE, 'utf8')) as { lastOpened?: string }).lastOpened
  } catch { return undefined }
}

/* Global instances are shared across route bundles and development reloads. */
const g = globalThis as typeof globalThis & {
  __zekoWorkspaceStores?: Map<string, StoreState>
  __zekoWorkspaceScope?: AsyncLocalStorage<StoreState>
}
const connectionString = databaseUrl()
export const storageMode = connectionString ? 'postgres' : 'local'
const stores = (g.__zekoWorkspaceStores ??= new Map<string, StoreState>())
const scope = (g.__zekoWorkspaceScope ??= new AsyncLocalStorage<StoreState>())

function storeFor(ownerId?: string) {
  const key = ownerId ?? 'legacy'
  let store = stores.get(key)
  if (!store) {
    const initial = connectionString || ownerId
      ? { entries: new Map<string, Entry>(), lastOpened: ownerId ? undefined : readLastOpened() }
      : load()
    store = { ...initial, ownerId, companions: new Map(), agentListeners: new Set() }
    stores.set(key, store)
  }
  return store
}

const state = () => scope.getStore() ?? storeFor()
const companions = () => state().companions
const agentListeners = () => state().agentListeners

export function personalWorkspace() {
  return !!scope.getStore()?.ownerId
}

export function currentWorkspace() {
  return state().ownerId
}

export function withWorkspace<RequestType extends Request, Args extends unknown[]>(
  handler: (request: RequestType, ...args: Args) => Promise<Response>,
) {
  return (request: RequestType, ...args: Args): Promise<Response> => {
    if (!googleAuthConfigured()) return scope.run(storeFor(), handler, request, ...args)
    const workspace = request.headers.get(WORKSPACE_HEADER)
    if (workspace === 'legacy' && new URL(request.url).pathname === '/api/mcp') {
      return scope.run(storeFor(), handler, request, ...args)
    }
    if (!workspaceId(workspace)) return Promise.resolve(Response.json({ error: 'Sign in to Zeko.' }, { status: 401 }))
    return scope.run(storeFor(workspace), handler, request, ...args)
  }
}

export async function prepareStore(checkAccounts = false) {
  if (checkAccounts && googleAuthConfigured()) {
    const db = workspaceDatabase(connectionString)
    await db.select({ id: users.id }).from(users)
      .leftJoin(oauthAccounts, eq(oauthAccounts.userId, users.id))
      .leftJoin(accountCanvases, eq(accountCanvases.ownerId, users.id))
      .leftJoin(mcpOAuthGrants, eq(mcpOAuthGrants.userId, users.id))
      .limit(1)
  }
  if (!connectionString) return
  const store = state()
  const db = workspaceDatabase(connectionString)
  const persistence = (store.database ??= databasePersistence(db, store.ownerId))
  store.ready ??= persistence.load().then((rows) => {
    store.entries = new Map(rows.map(({ id, snapshot }) => [id, { board: stamp(recoverRuns(snapshot)), listeners: new Set() }]))
  }).catch(() => {
    store.ready = undefined
    throw new Error('Could not load canvases from PostgreSQL. Check DATABASE_URL and run npm run db:migrate.')
  })
  await store.ready
}

export async function flushCanvas(id: string) {
  try {
    await state().database?.flush(id)
  } catch (error) {
    if (error instanceof CanvasWriteConflict) throw error
    throw new Error('Could not confirm the canvas save in PostgreSQL. Zeko will retry.')
  }
}

function withCompanions(board: Board): Board {
  if (!companions().size) return board
  const agents = { ...board.agents }
  for (const [name, { connectedAt }] of companions()) {
    const previous = Object.hasOwn(agents, name) ? agents[name] : undefined
    agents[name] = {
      name,
      message: previous?.message ?? 'Connected through Zeko CLI',
      working: previous?.working ?? false,
      frameId: previous?.frameId,
      lastSeen: previous?.lastSeen ?? connectedAt,
      connectedAt,
      mcpConnectedAt: previous?.mcpConnectedAt,
      companion: true,
    }
  }
  return { ...board, agents }
}

/** Companion presence lasts as long as its live connection and stays out of saved boards. */
export function connectCompanion(name: string): () => void {
  const store = state()
  const existing = store.companions.get(name)
  if (existing) existing.clients += 1
  else {
    companions().set(name, { connectedAt: Date.now(), clients: 1 })
    publishCompanions()
  }
  let closed = false
  return () => scope.run(store, () => {
    if (closed) return
    closed = true
    const current = companions().get(name)
    if (!current || --current.clients > 0) return
    companions().delete(name)
    publishCompanions()
  })
}

function publishCompanions() {
  for (const entry of state().entries.values()) {
    if (!entry.listeners.size) continue
    const snapshot = withCompanions(entry.board)
    for (const listener of entry.listeners) listener(snapshot)
  }
  publishAgents()
}

function persist(id: string) {
  const { entries, database } = state()
  const entry = entries.get(id)
  if (!entry) return
  if (database) {
    database.enqueue(id, entry.board)
    return
  }
  clearTimeout(entry.saveTimer)
  entry.saveTimer = setTimeout(() => writeAtomic(join(BOARDS_DIR, `${id}.json`), JSON.stringify(entry.board)), 250)
}

function publish(id: string) {
  const entry = state().entries.get(id)!
  persist(id)
  if (!entry.listeners.size) return
  const snapshot = withCompanions(entry.board)
  for (const listener of entry.listeners) listener(snapshot)
}

/** The canvas a request means: the one it names, else the one opened last, else the one edited last. */
export function resolveId(id?: string | null): string {
  const { entries, lastOpened } = state()
  if (id && entries.has(id)) return id
  if (lastOpened && entries.has(lastOpened)) return lastOpened
  return listBoards()[0]?.id ?? openSampleBoard()
}

export function hasBoard(id: string) {
  return state().entries.has(id)
}

export function hasCanvases() {
  return state().entries.size > 0
}

const MCP_PRESENCE_INTERVAL = 5000

export function needsMcpPresence(id: string, actor: Actor) {
  const agents = state().entries.get(id)?.board.agents
  if (!agents) return false
  const connected = Object.hasOwn(agents, actor.name) ? agents[actor.name]?.mcpConnectedAt : undefined
  return !connected || Date.now() - connected >= MCP_PRESENCE_INTERVAL
}

export function getBoard(id: string): Board {
  const entry = state().entries.get(id)!
  const upgradedLabels = upgradeSheetLabels(entry.board)
  if (upgradedLabels !== entry.board) {
    entry.board = upgradedLabels
    publish(id)
  }
  if (id === SAMPLE_ID && !entry.samplePrototypeChecked) {
    entry.samplePrototypeChecked = true
    const upgraded = addSamplePrototype(entry.board)
    if (upgraded !== entry.board) {
      entry.board = upgraded
      publish(id)
    }
  }
  return withCompanions(entry.board)
}

/** Opening the sample reuses its stable ID. A separate create action makes a fresh copy. */
export function openSampleBoard(): string {
  return hasBoard(SAMPLE_ID) ? SAMPLE_ID : createBoard({ sample: true })
}

export function markOpened(id: string) {
  if (!state().entries.has(id) || state().lastOpened === id) return
  state().lastOpened = id
  if (!state().ownerId) writeAtomic(META_FILE, JSON.stringify({ lastOpened: id }))
  if (companions().size) publishAgents()
}

/** Changes that count as editing the canvas. Agents checking in don't. */
const PRESENCE_OPS = new Set<Op['type']>(['agent.status', 'agent.connect'])
const QUIET_OPS = new Set<Op['type']>([...PRESENCE_OPS, 'task.run.message', 'task.run.stream', 'task.run.close'])

export function dispatch(id: string, op: Op, actor: Actor): Board {
  const entry = state().entries.get(id)!
  const next = applyOp(entry.board, op, actor)
  entry.board = QUIET_OPS.has(op.type) ? next : { ...next, updatedAt: Date.now() }
  publish(id)
  if (PRESENCE_OPS.has(op.type)) publishAgents()
  return entry.board
}

export function subscribe(id: string, listener: Listener): () => void {
  const entry = state().entries.get(id)!
  entry.listeners.add(listener)
  return () => entry.listeners.delete(listener)
}

function publishAgents() {
  if (!agentListeners().size) return
  const agents = agentPresences()
  for (const listener of agentListeners()) listener(agents)
}

export function subscribeAgents(listener: (agents: SeenAgent[]) => void): () => void {
  const listeners = agentListeners()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function resetBoard(id: string): Board {
  const entry = state().entries.get(id)!
  entry.board = { ...seedBoard(), createdAt: entry.board.createdAt, updatedAt: Date.now(), version: entry.board.version + 1 }
  publish(id)
  publishAgents()
  return entry.board
}

/** Swaps in a board someone exported earlier. Presence is dropped: those agents are not here. */
export function replaceBoard(id: string, next: Board): Board {
  const entry = state().entries.get(id)!
  entry.board = upgradeSheetLabels(recoverRuns({ ...next, agents: {}, createdAt: entry.board.createdAt, updatedAt: Date.now(), version: entry.board.version + 1 }))
  publish(id)
  publishAgents()
  return entry.board
}

export function createBoard({ name, sample, from }: { name?: string; sample?: boolean; from?: Board } = {}): string {
  const { entries, database } = state()
  const taken = (id: string) => entries.has(id) || database?.reserved(id)
  let id = sample && !taken(SAMPLE_ID) ? SAMPLE_ID : nanoid(10)
  while (!validId(id) || taken(id)) id = nanoid(10)
  const now = Date.now()
  const base = from ? recoverRuns({ ...structuredClone(from), agents: {} }) : sample ? seedBoard() : emptyBoard()
  const board = upgradeSheetLabels({ ...base, name: name?.trim() || base.name || 'Untitled canvas', createdAt: now, updatedAt: now, version: 0 })
  entries.set(id, { board, listeners: new Set() })
  if (database) database.enqueue(id, board)
  else writeAtomic(join(BOARDS_DIR, `${id}.json`), JSON.stringify(board))
  return id
}

/** Archives the canvas while preserving the snapshot in its storage backend. */
export function deleteBoard(id: string): boolean {
  const store = state()
  const entry = store.entries.get(id)
  if (!entry) return false
  clearTimeout(entry.saveTimer)
  if (store.database) store.database.enqueue(id, entry.board, new Date())
  else {
    writeAtomic(join(TRASH_DIR, `${id}-${Date.now()}.json`), JSON.stringify(entry.board))
    rmSync(join(BOARDS_DIR, `${id}.json`), { force: true })
  }
  store.entries.delete(id)
  if (store.lastOpened === id) store.lastOpened = undefined
  publishAgents()
  return true
}

export interface CanvasSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  frames: number
  openTasks: number
  agents: string[]
  /** the first screen on the canvas, for the card's picture */
  cover: { html: string; w: number; h: number } | null
}

export function workspaceStarted() {
  const { entries, database } = state()
  return entries.size > 0 || (database?.hasStoredCanvases() ?? false)
}

const COVER_LIMIT = 250_000

export function listBoards(): CanvasSummary[] {
  const now = Date.now()
  return [...state().entries.entries()]
    .map(([id, { board }]) => {
      const frames = visibleFrames(board)
      // The biggest screen makes the best picture; notes and small frames don't.
      const first = frames.filter((f) => f.kind === 'sketch').sort((a, b) => b.w * b.h - a.w * a.h || a.y - b.y)[0]
      const shown = first?.deckId ? deckFront(board, first.deckId) ?? first : first
      return {
        id,
        name: board.name,
        createdAt: board.createdAt ?? 0,
        updatedAt: board.updatedAt ?? 0,
        frames: frames.length,
        openTasks: board.tasks.filter((t) => t.status !== 'done').length,
        agents: Object.values(board.agents)
          .filter((a) => now - a.lastSeen < AGENT_AWAY_MS)
          .map((a) => a.name),
        cover: shown?.html && shown.html.length < COVER_LIMIT ? { html: withDesignTokens(shown.html, board.design), w: shown.w, h: shown.h } : null,
      }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Every agent seen on any canvas, newest first. */
export function agentPresences(): SeenAgent[] {
  const seen: SeenAgent[] = []
  const { entries, lastOpened } = state()
  const companionCanvas = companions().size
    ? lastOpened && entries.has(lastOpened) ? lastOpened : listBoards()[0]?.id
    : undefined
  if (companionCanvas) {
    for (const [name, { connectedAt }] of companions()) {
      const mcpConnectedAt = Math.max(0, ...[...state().entries.values()].map(({ board }) => board.agents[name]?.mcpConnectedAt ?? 0)) || undefined
      seen.push({ name, lastSeen: Date.now(), connectedAt, mcpConnectedAt, canvas: companionCanvas, companion: true })
    }
  }
  for (const [id, { board }] of state().entries) {
    for (const a of Object.values(board.agents)) {
      if (id === companionCanvas && companions().has(a.name)) continue
      seen.push({ name: a.name, lastSeen: a.lastSeen, connectedAt: a.connectedAt, mcpConnectedAt: a.mcpConnectedAt, canvas: id })
    }
  }
  return seen.sort((a, b) => b.lastSeen - a.lastSeen)
}

export function knownAgents(): SeenAgent[] {
  const names = new Set<string>()
  return agentPresences().filter((agent) => {
    if (names.has(agent.name)) return false
    names.add(agent.name)
    return true
  })
}
