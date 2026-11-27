import type { Activity, Actor, AgentPresence, Board, BoardPage, Deck, Frame, MemoryRule, Op, SketchComponent, Task } from './types'
import { DEFAULT_THEME, defaultDesign, tokenLabels, validTokenName, validTokenValue } from './tokens'
import { acpAgent, readAcpSelection } from './acp'
import { shapeDocument } from './client/draw'
import { readCanvasSkill } from './canvas-skills'
import { componentBody, componentDocument, replaceInstances, withRootAttribute, INSTANCE_ATTR } from './components'
import { withShaderRuntime } from './shaders'

const MAX_ACTIVITY = 60
const LANE_GAP = 240
const CELL_GAP = 96
export const RULE_TEXT_LIMIT = 20_000

function memoryRule(value: unknown): MemoryRule | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { id, title, text } = value as Partial<MemoryRule>
  if (typeof id !== 'string' || !/^[\w-]{1,40}$/.test(id) || typeof title !== 'string' || typeof text !== 'string') return undefined
  const name = title.trim().replace(/\s+/g, ' ').slice(0, 120)
  const body = text.trim().slice(0, RULE_TEXT_LIMIT)
  return name && body ? { id, title: name, text: body } : undefined
}

export function readMemoryRules(value: unknown): MemoryRule[] | undefined {
  if (!Array.isArray(value)) return undefined
  const rules = new Map<string, MemoryRule>()
  for (const item of value) {
    const rule = memoryRule(item)
    if (rule) rules.set(rule.id, rule)
  }
  return [...rules.values()]
}

export function designGuidelines(board: Board) {
  return [board.guidelines?.trim(), ...(board.memoryRules ?? []).map((rule) => `## ${rule.title}\n${rule.text}`)].filter(Boolean).join('\n\n')
}

export function emptyBoard(): Board {
  return {
    name: 'Untitled canvas',
    appUrl: 'http://localhost:3000',
    frames: [],
    decks: {},
    comments: [],
    tasks: [],
    agents: {},
    lanes: [],
    activity: [],
    version: 0,
  }
}

function isSketchComponent(input: unknown): input is SketchComponent {
  if (!input || typeof input !== 'object') return false
  const { id, name, tag, html, w, h } = input as Partial<SketchComponent>
  return typeof id === 'string' && /^[-\w]{1,40}$/.test(id) &&
    typeof name === 'string' && !!name.trim() && name.length <= 120 &&
    typeof tag === 'string' && /^[a-z][a-z0-9-]*$/.test(tag) &&
    typeof html === 'string' && !!html &&
    ((input as Partial<SketchComponent>).body === undefined || typeof (input as Partial<SketchComponent>).body === 'string') &&
    typeof w === 'number' && Number.isFinite(w) && w > 0 &&
    typeof h === 'number' && Number.isFinite(h) && h > 0
}

export function readSketchComponents(input: unknown): SketchComponent[] | undefined {
  if (!Array.isArray(input)) return undefined
  return [...new Map(input.filter(isSketchComponent).map((component) => [component.id, component])).values()]
}

const defaultPage: BoardPage = { id: 'page-1', name: 'Page 1' }

export function boardPages(board: Board): BoardPage[] {
  return board.pages?.length ? board.pages : [defaultPage]
}

export function framePage(board: Board, frame: Frame): string {
  const pages = boardPages(board)
  return pages.find((p) => p.id === frame.pageId)?.id ?? pages[0]!.id
}

export function pageStart(board: Board, pageId: string): string | undefined {
  const pages = boardPages(board)
  const start = pageId === pages[0]!.id ? board.flowStart : pages.find((p) => p.id === pageId)?.flowStart
  const frame = board.frames.find((f) => f.id === start)
  return frame && framePage(board, frame) === pageId ? frame.id : undefined
}

/** Members of a deck, oldest first. */
export function deckMembers(board: Board, deckId: string): Frame[] {
  return board.frames.filter((f) => f.deckId === deckId).sort((a, b) => a.createdAt - b.createdAt)
}

/** The frame a deck shows on top. */
export function deckFront(board: Board, deckId: string): Frame | undefined {
  const members = deckMembers(board, deckId)
  const front = board.decks[deckId]?.front
  return members.find((f) => f.id === front) ?? members[members.length - 1]
}

/** Frames as the canvas shows them: one entry per loose frame or deck. */
export function visibleFrames(board: Board, pageId?: string): Frame[] {
  const seen = new Set<string>()
  const out: Frame[] = []
  for (const f of board.frames) {
    if (pageId && framePage(board, f) !== pageId) continue
    if (!f.deckId) {
      out.push(f)
      continue
    }
    if (seen.has(f.deckId)) continue
    seen.add(f.deckId)
    const front = deckFront(board, f.deckId)
    if (front) out.push(front)
  }
  return out
}

/** Older completions have no result IDs. Look for sketches made during the request, then use its attached frames. */
export function taskResultFrames(board: Board, task: Task, since = task.at): Frame[] {
  const ids = task.resultFrameIds
  if (ids) return board.frames.filter((f) => ids.includes(f.id))
  const created = board.frames.filter(
    (f) => f.createdBy?.kind === 'agent' && f.createdBy.name === task.claimedBy && f.createdAt >= since && f.createdAt <= task.updatedAt,
  )
  return created.length ? created : board.frames.filter((f) => task.frameIds.includes(f.id))
}

function log(board: Board, actor: Actor, text: string) {
  const entry: Activity = { id: `${Date.now()}-${board.activity.length}`, actor, text, at: Date.now() }
  board.activity = [entry, ...board.activity].slice(0, MAX_ACTIVITY)
}

function frameName(board: Board, id: string) {
  return board.frames.find((f) => f.id === id)?.name ?? 'a frame'
}

export const UNROUTED = 'Not on a route'

/** Routes in order, frames without one last. */
export function byRoute(a: string, b: string) {
  return a === UNROUTED ? 1 : b === UNROUTED ? -1 : a.localeCompare(b)
}

function placeSheetLabel(board: Board, pageId: string, route: string, x: number, rowY: number, actor: Actor, now: number) {
  const right = x - 32
  const existing = board.frames.find((frame) => frame.sheetRoute === route && framePage(board, frame) === pageId)
  if (existing) {
    moveFrameOrDeck(board, existing, right - existing.w, rowY)
    return
  }
  let suffix = board.frames.length + 1
  while (board.frames.some((frame) => frame.id === `route-label-${suffix}`)) suffix++
  const w = Math.max(48, Array.from(route).length * 24 + 2)
  board.frames.push({
    id: `route-label-${suffix}`, name: route, pageId, kind: 'sketch', shape: 'text', sheetRoute: route,
    x: right - w, y: rowY, w, h: 32,
    html: shapeDocument('text', { text: route, align: 'right' }), createdBy: actor, createdAt: now, updatedAt: now,
  })
}

/** Upgrade route headings saved before Arrange used editable text layers. */
export function upgradeSheetLabels(input: Board): Board {
  if (!input.lanes?.length) return input
  const board = { ...input, frames: input.frames.map((frame) => ({ ...frame })), lanes: [] }
  const firstPage = boardPages(board)[0]!.id
  for (const lane of input.lanes) {
    if (!lane || typeof lane.label !== 'string' || !Number.isFinite(lane.y)) continue
    const pageId = lane.pageId ?? firstPage
    const row = visibleFrames(input, pageId).filter((frame) => !frame.shape && (frame.route?.trim() || UNROUTED) === lane.label)
    if (row.length) placeSheetLabel(board, pageId, lane.label, Math.min(...row.map((frame) => frame.x)), lane.y, { kind: 'human', name: 'You' }, input.createdAt ?? 0)
  }
  return board
}

function removeOrphanSheetLabels(board: Board, moved = new Set<string>()) {
  const labels = board.frames.filter((frame) => frame.sheetRoute !== undefined)
  if (!labels.length) return
  const routes = new Map<string, Set<string>>()
  for (const frame of board.frames) {
    if (frame.shape) continue
    const page = framePage(board, frame)
    const keys = routes.get(page) ?? new Set<string>()
    keys.add(frame.route?.trim() || UNROUTED)
    routes.set(page, keys)
  }
  const removed = new Set<string>()
  for (const frame of labels) {
    if (routes.get(framePage(board, frame))?.has(frame.sheetRoute!)) continue
    if (moved.has(frame.id)) delete frame.sheetRoute
    else removed.add(frame.id)
  }
  if (!removed.size) return
  board.frames = board.frames.filter((frame) => !removed.has(frame.id))
  board.comments = board.comments.filter((comment) => !removed.has(comment.frameId))
}

/** Lay frames out as a sheet: one lane per route, states left to right. */
function arrange(board: Board, pageId: string, actor: Actor, now: number) {
  // Shapes drawn on the canvas aren't screens: they stay where they were drawn.
  const cells = visibleFrames(board, pageId).filter((f) => !f.shape)
  const lanes = new Map<string, Frame[]>()
  for (const f of cells) {
    const key = f.route?.trim() || UNROUTED
    lanes.set(key, [...(lanes.get(key) ?? []), f])
  }
  const order = [...lanes.keys()].sort(byRoute)
  let y = 0
  for (const key of order) {
    const row = (lanes.get(key) ?? []).sort((a, b) => stateRank(a.state) - stateRank(b.state))
    placeSheetLabel(board, pageId, key, 0, y, actor, now)
    let x = 0
    let tallest = 0
    for (const cell of row) {
      moveFrameOrDeck(board, cell, x, y)
      x += cell.w + CELL_GAP
      tallest = Math.max(tallest, cell.h)
    }
    y += tallest + LANE_GAP
  }
}

/** A row wraps once it is this wide, so a canvas grows in both directions instead of into one long strip. */
export const ROW_MAX_WIDTH = 7200
const ROW_GAP = 200

/**
 * Where a new frame goes. Another state of a screen joins that screen's row, after the states already there;
 * a new screen starts a row of its own below everything; frames with no route continue the last row until it
 * is full. Nothing is placed on top of another frame.
 */
export function placeFrame(board: Board, pageId: string, frame: { w: number; h: number; route?: string }): { x: number; y: number } {
  const frames = visibleFrames(board, pageId).filter((f) => !f.shape)
  if (!frames.length) return { x: 0, y: 0 }
  const left = Math.min(...frames.map((f) => f.x))
  const bottom = Math.max(...frames.map((f) => f.y + f.h))
  const newRow = { x: left, y: bottom + ROW_GAP }
  const free = (x: number, y: number) => !frames.some((f) => x < f.x + f.w + CELL_GAP / 2 && x + frame.w + CELL_GAP / 2 > f.x && y < f.y + f.h + CELL_GAP / 2 && y + frame.h + CELL_GAP / 2 > f.y)
  // The frames in the band of rows starting at y, to find the end of that row.
  const rowEnd = (y: number) => {
    const inRow = frames.filter((f) => f.y < y + frame.h && f.y + f.h > y)
    return inRow.length ? Math.max(...inRow.map((f) => f.x + f.w)) : left
  }
  const nextTo = (y: number) => {
    const x = rowEnd(y) + CELL_GAP
    return x + frame.w - left <= ROW_MAX_WIDTH && free(x, y) ? { x, y } : undefined
  }
  const route = frame.route?.trim()
  if (route) {
    const lane = frames.filter((f) => f.route?.trim() === route)
    if (!lane.length) return newRow
    return nextTo(Math.min(...lane.map((f) => f.y))) ?? newRow
  }
  const lastRowTop = Math.max(...frames.map((f) => f.y))
  return nextTo(lastRowTop) ?? newRow
}

export const STATE_ORDER = ['default', 'loading', 'empty', 'error', 'success']
export function stateRank(state?: string) {
  const i = STATE_ORDER.indexOf((state ?? 'default').toLowerCase())
  return i === -1 ? STATE_ORDER.length : i
}

function moveFrameOrDeck(board: Board, frame: Frame, x: number, y: number) {
  const dx = x - frame.x
  const dy = y - frame.y
  for (const f of board.frames) {
    if (f.id === frame.id || (frame.deckId && f.deckId === frame.deckId)) {
      f.x += dx
      f.y += dy
    }
  }
}

/**
 * Applies one operation to a copy of the board. Pure: the same op gives the
 * same board on the server and in the browser's optimistic copy.
 */
export function applyOp(input: Board, op: Op, actor: Actor): Board {
  const board: Board = structuredClone(upgradeSheetLabels(input))
  const now = Date.now()
  board.version += 1

  switch (op.type) {
    case 'batch': {
      let next = board
      for (const inner of op.ops) if (inner.type !== 'batch') next = applyOp(next, inner, actor)
      return next
    }
    case 'restore': {
      const dropFrames = new Set([...op.removeFrames, ...op.frames.map((f) => f.id)])
      board.frames = [...board.frames.filter((f) => !dropFrames.has(f.id)), ...op.frames].sort((a, b) => a.createdAt - b.createdAt)
      const dropComments = new Set([...op.removeComments, ...op.comments.map((c) => c.id)])
      board.comments = [...board.comments.filter((c) => !dropComments.has(c.id)), ...op.comments].sort((a, b) => a.at - b.at)
      for (const [id, deck] of Object.entries(op.decks)) {
        if (deck) board.decks[id] = deck
        else delete board.decks[id]
      }
      if (op.board) Object.assign(board, op.board)
      break
    }
    case 'board.update': {
      if (op.name !== undefined) board.name = op.name.slice(0, 120)
      if (op.appUrl !== undefined) board.appUrl = op.appUrl.trim()
      if (op.flowStart !== undefined) {
        const pages = boardPages(board)
        if (!op.pageId || op.pageId === pages[0]!.id) board.flowStart = op.flowStart || undefined
        else board.pages = pages.map((p) => (p.id === op.pageId ? { ...p, flowStart: op.flowStart || undefined } : p))
      }
      if (op.guidelines !== undefined) {
        board.guidelines = op.guidelines.slice(0, RULE_TEXT_LIMIT)
        log(board, actor, 'updated the design guidelines')
      }
      break
    }
    case 'memory.rule.save': {
      const rule = memoryRule(op.rule)
      if (!rule) break
      const rules = board.memoryRules ?? []
      board.memoryRules = rules.some((existing) => existing.id === rule.id)
        ? rules.map((existing) => existing.id === rule.id ? rule : existing)
        : [...rules, rule]
      log(board, actor, `saved the design rule “${rule.title}”`)
      break
    }
    case 'memory.rule.remove': {
      board.memoryRules = board.memoryRules?.filter((rule) => rule.id !== op.id)
      break
    }
    case 'memory.skill.save': {
      const skill = readCanvasSkill(op.skill)
      if (!skill) break
      const skills = board.skills ?? []
      board.skills = skills.some((existing) => existing.id === skill.id)
        ? skills.map((existing) => existing.id === skill.id ? skill : existing)
        : [...skills, skill]
      log(board, actor, `saved the skill “${skill.title}”`)
      break
    }
    case 'memory.skill.remove': {
      board.skills = board.skills?.filter((skill) => skill.id !== op.id)
      break
    }
    case 'page.add': {
      const pages = boardPages(board)
      const name = op.name.trim().slice(0, 80)
      if (name && /^[-\w]{1,40}$/.test(op.id) && !pages.some((p) => p.id === op.id)) board.pages = [...pages, { id: op.id, name }]
      break
    }
    case 'page.rename': {
      const name = op.name.trim().slice(0, 80)
      if (name) board.pages = boardPages(board).map((p) => (p.id === op.id ? { ...p, name } : p))
      break
    }
    case 'page.remove': {
      const pages = boardPages(board)
      if (op.id === pages[0]!.id || board.frames.some((f) => framePage(board, f) === op.id)) break
      if (board.tasks.some((task) => task.pageId === op.id && task.status !== 'done')) break
      if (pages.some((p) => p.id === op.id)) {
        board.pages = pages.filter((p) => p.id !== op.id)
        board.lanes = board.lanes.filter((lane) => lane.pageId !== op.id)
      }
      break
    }
    case 'page.moveFrames': {
      if (!boardPages(board).some((p) => p.id === op.pageId)) break
      const selected = new Set(op.frameIds)
      const decks = new Set(board.frames.flatMap((f) => (f.deckId && selected.has(f.id) ? [f.deckId] : [])))
      for (const frame of board.frames) {
        if (selected.has(frame.id) || (frame.deckId && decks.has(frame.deckId))) frame.pageId = op.pageId
      }
      removeOrphanSheetLabels(board, selected)
      break
    }
    case 'design.theme.add': {
      const design = board.design ?? defaultDesign
      const name = op.name.trim().slice(0, 64)
      if (name && /^[-\w]{1,40}$/.test(op.id) && !design.themes.some((theme) => theme.id === op.id)) {
        board.design = { ...design, themeId: op.id, themes: [...design.themes, { id: op.id, name }] }
      }
      break
    }
    case 'design.theme.select': {
      const design = board.design ?? defaultDesign
      if (design.themes.some((theme) => theme.id === op.id)) board.design = { ...design, themeId: op.id }
      break
    }
    case 'design.token.set': {
      const design = board.design ?? defaultDesign
      const value = op.value.trim()
      if (!validTokenName(op.name) || !Object.hasOwn(tokenLabels, op.kind) || !design.themes.some((theme) => theme.id === op.themeId)) break
      const existing = design.tokens.find((token) => token.name === op.name)
      const canClear = existing && !value && op.themeId !== DEFAULT_THEME
      if (!canClear && !validTokenValue(value)) break
      const values = { ...(existing?.values ?? { [DEFAULT_THEME]: value }) }
      if (canClear) delete values[op.themeId]
      else values[op.themeId] = value
      const token = { name: op.name, kind: existing?.kind ?? op.kind, values }
      const tokens = existing ? design.tokens.map((item) => (item.name === token.name ? token : item)) : [...design.tokens, token]
      board.design = { ...design, tokens }
      break
    }
    case 'design.token.remove': {
      if (board.design) board.design.tokens = board.design.tokens.filter((token) => token.name !== op.name)
      break
    }
    case 'component.save': {
      if (isSketchComponent(op.component) && !board.components?.some((component) => component.id === op.component.id)) {
        board.components = [...(board.components ?? []), op.component]
      }
      break
    }
    case 'component.update': {
      const component = board.components?.find((c) => c.id === op.id)
      if (!component) break
      if (typeof op.name === 'string' && op.name.trim()) {
        component.name = op.name.trim().slice(0, 120)
        for (const frame of board.frames) if (frame.componentId === op.id) frame.name = component.name
      }
      if (typeof op.body === 'string' && op.body.trim()) {
        syncComponent(board, op.id, withRootAttribute(op.body.trim(), INSTANCE_ATTR, op.id), actor, now, new Set())
      }
      break
    }
    case 'component.remove': {
      if (board.components) board.components = board.components.filter((component) => component.id !== op.id)
      break
    }
    case 'frame.create': {
      const html = op.frame.html !== undefined && op.frame.kind === 'sketch' ? withShaderRuntime(op.frame.html) : op.frame.html
      board.frames.push({ ...op.frame, html, createdBy: actor, createdAt: now, updatedAt: now })
      log(board, actor, `added ${op.frame.name}`)
      break
    }
    case 'frame.update': {
      const frame = board.frames.find((f) => f.id === op.id)
      if (!frame) break
      const { x, y, ...rest } = op.patch
      if (x !== undefined || y !== undefined) moveFrameOrDeck(board, frame, x ?? frame.x, y ?? frame.y)
      if (rest.w !== undefined || rest.h !== undefined) {
        for (const f of board.frames) {
          if (f.id === frame.id || (frame.deckId && f.deckId === frame.deckId)) {
            f.w = Math.max(f.shape ? 2 : 160, Math.round(rest.w ?? f.w))
            f.h = Math.max(f.shape ? 2 : 120, Math.round(rest.h ?? f.h))
          }
        }
      }
      const { w: _w, h: _h, ...content } = rest
      if (content.html !== undefined && frame.kind === 'sketch') content.html = withShaderRuntime(content.html)
      const htmlChanged = content.html !== undefined && content.html !== frame.html
      if (htmlChanged && frame.html !== undefined) keepVersion(frame, actor, now)
      Object.assign(frame, content)
      frame.updatedAt = now
      if (htmlChanged && frame.componentId) syncFromMain(board, frame, actor, now)
      if (content.html !== undefined && actor.kind === 'agent') log(board, actor, `edited ${frame.name}`)
      if ('route' in content) removeOrphanSheetLabels(board)
      break
    }
    case 'frame.restoreVersion': {
      const frame = board.frames.find((f) => f.id === op.id)
      const version = frame?.versions?.find((v) => v.at === op.at)
      if (!frame || !version) break
      keepVersion(frame, actor, now, true)
      frame.html = version.html
      frame.updatedAt = now
      if (frame.componentId) syncFromMain(board, frame, actor, now)
      log(board, actor, `restored an earlier version of ${frame.name}`)
      break
    }
    case 'frame.delete': {
      const frame = board.frames.find((f) => f.id === op.id)
      if (!frame) break
      board.frames = board.frames.filter((f) => f.id !== op.id)
      board.comments = board.comments.filter((c) => c.frameId !== op.id)
      if (frame.deckId) settleDeck(board, frame.deckId)
      if (!frame.shape) removeOrphanSheetLabels(board)
      log(board, actor, `removed ${frame.name}`)
      break
    }
    case 'frame.variant': {
      const source = board.frames.find((f) => f.id === op.id)
      if (!source) break
      const deckId = source.deckId ?? source.id
      source.deckId = deckId
      const count = deckMembers(board, deckId).length
      // Fields left out keep the source's value; a change of kind drops the other kind's content.
      const patch = Object.fromEntries(Object.entries(op.patch ?? {}).filter(([, v]) => v !== undefined))
      const variant: Frame = {
        ...structuredClone(source),
        id: op.newId,
        name: `${source.name.replace(/ · v\d+$/, '')} · v${count + 1}`,
        deckId,
        createdBy: actor,
        createdAt: now,
        updatedAt: now,
        approved: undefined,
        reference: undefined,
        ...patch,
        variantOf: source.id,
        x: source.x,
        y: source.y,
        w: source.w,
        h: source.h,
      }
      if (variant.kind === 'sketch') variant.url = undefined
      else variant.html = undefined
      board.frames.push(variant)
      board.decks[deckId] = { front: op.newId }
      log(board, actor, `made a variant of ${source.name}`)
      break
    }
    case 'deck.front': {
      if (deckMembers(board, op.deckId).some((f) => f.id === op.frameId)) board.decks[op.deckId] = { front: op.frameId }
      break
    }
    case 'deck.keep': {
      const keep = board.frames.find((f) => f.id === op.frameId)
      if (!keep?.deckId) break
      const deckId = keep.deckId
      const dropped = new Set(deckMembers(board, deckId).filter((f) => f.id !== keep.id).map((f) => f.id))
      board.frames = board.frames.filter((f) => !dropped.has(f.id))
      board.comments = board.comments.filter((c) => !dropped.has(c.frameId))
      keep.deckId = undefined
      delete board.decks[deckId]
      removeOrphanSheetLabels(board)
      log(board, actor, `kept ${keep.name} and set ${dropped.size} other${dropped.size === 1 ? '' : 's'} aside`)
      break
    }
    case 'sheet.arrange': {
      arrange(board, op.pageId ?? boardPages(board)[0]!.id, actor, now)
      break
    }
    case 'comment.add': {
      board.comments.push({ ...op.comment, author: actor, resolved: false, replies: [], at: now })
      log(board, actor, `commented on ${frameName(board, op.comment.frameId)}`)
      break
    }
    case 'comment.reply': {
      const c = board.comments.find((x) => x.id === op.id)
      if (!c) break
      c.replies.push({ id: op.replyId, author: actor, text: op.text, at: now })
      if (actor.kind === 'agent') log(board, actor, `replied on ${frameName(board, c.frameId)}`)
      break
    }
    case 'comment.resolve': {
      const c = board.comments.find((x) => x.id === op.id)
      if (c) c.resolved = op.resolved
      break
    }
    case 'comment.delete': {
      board.comments = board.comments.filter((c) => c.id !== op.id)
      break
    }
    case 'task.add': {
      if (board.tasks.some((task) => task.id === op.id)) break
      const element = op.element && op.frameIds.includes(op.element.frameId) ? op.element : undefined
      const chatId = typeof op.chatId === 'string' && /^[\w-]{1,40}$/.test(op.chatId) ? op.chatId : undefined
      const acp = readAcpSelection(op.acp)
      const assignee = acpAgent(acp?.agent)?.name ?? op.assignee
      board.tasks.unshift({ id: op.id, text: op.text, frameIds: op.frameIds, element, assignee, acp, pageId: op.pageId, chatId, status: 'open', author: actor, at: now, updatedAt: now })
      log(board, actor, `asked agents: ${op.text.slice(0, 60)}`)
      break
    }
    case 'task.run.start': {
      const task = board.tasks.find((item) => item.id === op.id)
      if (task?.status === 'open' && (!task.localRun || task.localRun.error)) {
        task.localRun = { id: op.runId }
        task.reply = undefined
        task.thinking = undefined
        task.tools = undefined
        task.updatedAt = now
      }
      break
    }
    case 'task.run.message': {
      const task = board.tasks.find((item) => item.id === op.id)
      const run = task?.localRun
      if (task && run?.id === op.runId && !run.error) {
        if (task.status === 'done') task.reply = op.message
        else run.message = op.message
      }
      break
    }
    case 'task.run.close': {
      const task = board.tasks.find((item) => item.id === op.id)
      if (task?.status === 'done' && task.localRun?.id === op.runId) {
        task.localRun = undefined
      }
      break
    }
    case 'task.run.stream': {
      const task = board.tasks.find((item) => item.id === op.id)
      if (task?.localRun?.id === op.runId && !task.localRun.error) {
        task.reply = op.reply || undefined
        task.thinking = op.thinking || undefined
        task.tools = op.tools.length ? op.tools : undefined
      }
      break
    }
    case 'task.run.fail': {
      const task = board.tasks.find((item) => item.id === op.id)
      if (task && task.status !== 'done' && task.localRun?.id === op.runId) {
        task.status = 'open'
        task.claimedBy = undefined
        task.localRun = { ...task.localRun, error: op.error }
        task.updatedAt = now
      }
      break
    }
    case 'task.claim': {
      const t = board.tasks.find((x) => x.id === op.id)
      if (!t || t.status === 'done') break
      t.status = 'claimed'
      t.claimedBy = actor.name
      t.updatedAt = now
      break
    }
    case 'task.complete': {
      const t = board.tasks.find((x) => x.id === op.id)
      if (!t) break
      const since = t.status === 'claimed' ? t.updatedAt : t.at
      t.status = 'done'
      if (t.localRun?.error) t.localRun = undefined
      t.claimedBy ??= actor.name
      t.summary = op.summary
      t.updatedAt = now
      if (op.resultFrameIds) {
        t.resultFrameIds = [...new Set(op.resultFrameIds)].filter((id) => board.frames.some((f) => f.id === id))
      } else {
        t.resultFrameIds ??= taskResultFrames(board, t, since).map((f) => f.id)
      }
      log(board, actor, `finished: ${t.text.slice(0, 60)}`)
      break
    }
    case 'task.delete': {
      board.tasks = board.tasks.filter((t) => t.id !== op.id)
      break
    }
    case 'agent.connect':
    case 'agent.status': {
      const previous = Object.hasOwn(board.agents, actor.name) ? board.agents[actor.name] : undefined
      const recent = previous && now - previous.lastSeen < AGENT_AWAY_MS ? previous : undefined
      const status = op.type === 'agent.status' ? op : recent
      board.agents = {
        ...board.agents,
        [actor.name]: {
          name: actor.name,
          message: status?.message ?? 'Connected to Zeko',
          frameId: status?.frameId,
          working: status?.working ?? false,
          lastSeen: now,
          connectedAt: op.type === 'agent.connect' ? now : previous?.connectedAt,
          mcpConnectedAt: op.type === 'agent.connect' ? now : previous?.mcpConnectedAt,
        },
      }
      break
    }
  }
  return board
}

const MAX_VERSIONS = 30
const QUIET_MS = 90_000

/**
 * Saves a sketch's current HTML before it changes. Edits by the same person in quick succession
 * share one saved version, so dragging a slider doesn't fill the history.
 */
/** The main copy of a component changed: carry its element to every instance. */
function syncFromMain(board: Board, main: Frame, actor: Actor, now: number) {
  const body = main.html && componentBody(main.html, main.componentId!)
  if (body) syncComponent(board, main.componentId!, body, actor, now, new Set([main.id]))
}

/** Rewrite each instance of a component, and follow on to components whose main copy contains one. */
function syncComponent(board: Board, id: string, body: string, actor: Actor, now: number, skip: Set<string>, depth = 0) {
  const component = board.components?.find((c) => c.id === id)
  if (!component || depth > 4) return
  component.body = body
  for (const frame of board.frames) {
    if (frame.kind !== 'sketch' || !frame.html || skip.has(frame.id)) continue
    const next = frame.componentId === id ? componentDocument(body) : replaceInstances(frame.html, id, body)
    if (next === frame.html) continue
    keepVersion(frame, actor, now)
    frame.html = next
    frame.updatedAt = now
    if (frame.componentId && frame.componentId !== id) {
      const nested = componentBody(next, frame.componentId)
      if (nested) syncComponent(board, frame.componentId, nested, actor, now, new Set([...skip, frame.id]), depth + 1)
    }
  }
  const main = board.frames.find((frame) => frame.componentId === id)
  component.html = main?.html ?? componentDocument(body)
}

function keepVersion(frame: Frame, actor: Actor, now: number, force = false) {
  if (frame.html === undefined) return
  const versions = (frame.versions ??= [])
  const last = versions[versions.length - 1]
  const recentSameEditor = last && last.by.name === actor.name && now - frame.updatedAt < QUIET_MS && now - last.at < QUIET_MS * 4
  if (!force && recentSameEditor) return
  versions.push({ html: frame.html, at: now, by: actor })
  if (versions.length > MAX_VERSIONS) versions.splice(0, versions.length - MAX_VERSIONS)
}

function settleDeck(board: Board, deckId: string) {
  const members = deckMembers(board, deckId)
  if (members.length <= 1) {
    for (const m of members) m.deckId = undefined
    delete board.decks[deckId]
    return
  }
  if (!members.some((m) => m.id === board.decks[deckId]?.front)) {
    board.decks[deckId] = { front: members[members.length - 1]!.id }
  }
}

export function resolveUrl(url: string | undefined, appUrl: string): string | undefined {
  if (!url) return undefined
  if (/^https?:\/\//i.test(url)) return url
  if (!appUrl) return undefined
  try {
    return new URL(url, appUrl.endsWith('/') ? appUrl : `${appUrl}/`).toString()
  } catch {
    return undefined
  }
}

export function parseWebsiteUrl(value: string | undefined): URL | undefined {
  if (typeof value !== 'string') return undefined
  const input = value.trim()
  if (/[\s\\]/.test(input)) return undefined
  const absolute = /^https?:\/\/[^/]/i.test(input)
  const bareHost = /^(?:localhost|\[[a-f0-9:.]+\]|[^.:/?#@]+(?:\.[^.:/?#@]+)+)(?::\d+)?(?:[/?#]|$)/i.test(input)
  if (!absolute && !bareHost) return undefined
  try {
    const url = new URL(absolute ? input : `https://${input}`)
    if (url.username || url.password) return undefined
    return url
  } catch {
    return undefined
  }
}

export function frameSourceUrl(frame: Pick<Frame, 'kind' | 'url'>, appUrl: string): string | undefined {
  if (frame.kind === 'website') return parseWebsiteUrl(frame.url)?.href
  if (frame.kind === 'live') return resolveUrl(frame.url, appUrl)
}

/** An agent counts as here if it has said something in the last two minutes. */
export const AGENT_AWAY_MS = 120_000

export function agentIsOnline(agent: Pick<AgentPresence, 'lastSeen' | 'companion'>, now: number) {
  return !!agent.companion || (now > 0 && now - agent.lastSeen < AGENT_AWAY_MS)
}

export const DEFAULT_CHAT_ID = 'default'

export function localAgentProvider(name?: string): 'codex' | 'claude' | undefined {
  const alias = name?.trim().toLowerCase()
  if (alias === 'codex' || alias === 'openai codex') return 'codex'
  if (alias === 'claude' || alias === 'claude code' || alias === 'anthropic claude') return 'claude'
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The operation that takes `after` back to `before`, covering frames, comments,
 * decks and the board's own settings. Requests and activity are left alone.
 * Returns null when nothing undoable changed.
 */
export function inverseOf(before: Board, after: Board): Op | null {
  const prevFrames = new Map(before.frames.map((f) => [f.id, f]))
  const nextFrames = new Map(after.frames.map((f) => [f.id, f]))
  const frames = before.frames.filter((f) => !same(f, nextFrames.get(f.id)))
  const removeFrames = after.frames.filter((f) => !prevFrames.has(f.id)).map((f) => f.id)

  const prevComments = new Map(before.comments.map((c) => [c.id, c]))
  const nextComments = new Map(after.comments.map((c) => [c.id, c]))
  const comments = before.comments.filter((c) => !same(c, nextComments.get(c.id)))
  const removeComments = after.comments.filter((c) => !prevComments.has(c.id)).map((c) => c.id)

  const decks: Record<string, Deck | null> = {}
  for (const id of new Set([...Object.keys(before.decks), ...Object.keys(after.decks)])) {
    if (!same(before.decks[id], after.decks[id])) decks[id] = before.decks[id] ?? null
  }

  const board: NonNullable<Extract<Op, { type: 'restore' }>['board']> = {}
  if (before.name !== after.name) board.name = before.name
  if (before.appUrl !== after.appUrl) board.appUrl = before.appUrl
  if (!same(before.lanes, after.lanes)) board.lanes = before.lanes
  if (before.guidelines !== after.guidelines) board.guidelines = before.guidelines ?? ''
  if (!same(before.memoryRules, after.memoryRules)) board.memoryRules = before.memoryRules ?? []
  if (!same(before.skills, after.skills)) board.skills = before.skills ?? []
  if (before.flowStart !== after.flowStart) board.flowStart = before.flowStart ?? ''
  if (!same(before.pages, after.pages)) board.pages = before.pages ?? []
  if (!same(before.design, after.design)) board.design = before.design ?? defaultDesign
  if (!same(before.components, after.components)) board.components = before.components ?? []

  const changed = frames.length + removeFrames.length + comments.length + removeComments.length + Object.keys(decks).length + Object.keys(board).length
  if (changed === 0) return null
  return { type: 'restore', frames, removeFrames, comments, removeComments, decks, board }
}
