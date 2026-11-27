import { deckFront, framePage, pageStart, STATE_ORDER, stateRank, visibleFrames } from './ops'
import type { Board, Frame } from './types'

export interface StateNode {
  id: string
  frame: Frame
  /** the screen it belongs to: its route, or its own name when it has none */
  screen: string
  state: string
  level: number
  x: number
  y: number
}

export interface StateEdge {
  from: string
  to: string
  /** how many links lead from one to the other */
  count: number
}

export interface MissingState {
  screen: string
  route: string
  state: string
  /** the screen's default frame, to place the new state beside */
  near: Frame
}

export interface StateMap {
  nodes: StateNode[]
  edges: StateEdge[]
  missing: MissingState[]
  start?: string
  width: number
  height: number
}

export const NODE = { w: 176, h: 60, gapX: 28, gapY: 72 }
/** The states most screens need besides their default. */
export const EXPECTED_STATES = ['loading', 'empty', 'error']

const GOTO = /data-zeko-goto\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/** Where a sketch's prototype links go, as frame ids, read straight from its HTML. */
export function linksOf(html: string | undefined): string[] {
  if (!html) return []
  return [...html.matchAll(GOTO)].map((m) => m[1] ?? m[2] ?? '').filter((to) => to && to !== 'back')
}

const screenOf = (f: Frame) => f.route?.trim() || f.name
const stateOf = (f: Frame) => f.state?.trim() || 'default'

/**
 * Every screen and state on a page, laid out top-down from the prototype's start screen along its links,
 * with the states each routed screen still lacks.
 */
export function stateMap(board: Board, pageId: string): StateMap {
  const frames = visibleFrames(board, pageId).filter((f) => !f.shape && !f.buildOf && f.kind !== 'website')
  const shown = (id: string) => {
    const f = board.frames.find((x) => x.id === id)
    const front = f?.deckId ? (deckFront(board, f.deckId) ?? f) : f
    return front && framePage(board, front) === pageId && frames.includes(front) ? front : undefined
  }

  const counts = new Map<string, StateEdge>()
  for (const f of frames) {
    for (const to of linksOf(f.html)) {
      const target = shown(to)
      if (!target || target.id === f.id) continue
      const key = `${f.id}>${target.id}`
      const edge = counts.get(key) ?? { from: f.id, to: target.id, count: 0 }
      edge.count++
      counts.set(key, edge)
    }
  }
  const edges = [...counts.values()]
  const out = new Map<string, string[]>()
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to])

  // Levels: breadth-first from the start screen, then from each screen nothing reached, in reading order.
  const order = [...frames].sort((a, b) => screenOf(a).localeCompare(screenOf(b)) || stateRank(a.state) - stateRank(b.state) || a.y - b.y || a.x - b.x)
  const startId = pageStart(board, pageId)
  const start = startId ? shown(startId) : undefined
  const level = new Map<string, number>()
  let base = 0
  const walk = (root: Frame) => {
    const queue: Frame[] = [root]
    level.set(root.id, base)
    let deepest = base
    while (queue.length) {
      const f = queue.shift()!
      const l = level.get(f.id)!
      deepest = Math.max(deepest, l)
      for (const to of out.get(f.id) ?? []) {
        if (level.has(to)) continue
        level.set(to, l + 1)
        queue.push(frames.find((x) => x.id === to)!)
      }
    }
    base = deepest + 1
  }
  if (start) walk(start)
  // Unlinked states of a screen sit beside its default rather than on rows of their own.
  for (const f of order) {
    if (level.has(f.id)) continue
    const sibling = order.find((o) => o !== f && level.has(o.id) && screenOf(o) === screenOf(f))
    if (sibling && !edges.some((e) => e.to === f.id)) level.set(f.id, level.get(sibling.id)!)
    else walk(f)
  }

  const rows: Frame[][] = []
  for (const f of order) (rows[level.get(f.id)!] ??= []).push(f)
  const packed = rows.filter(Boolean)
  const widest = Math.max(1, ...packed.map((r) => r.length))
  const width = widest * NODE.w + (widest - 1) * NODE.gapX
  const nodes: StateNode[] = []
  packed.forEach((row, l) => {
    const rowWidth = row.length * NODE.w + (row.length - 1) * NODE.gapX
    row.forEach((f, i) => nodes.push({
      id: f.id, frame: f, screen: screenOf(f), state: stateOf(f), level: l,
      x: (width - rowWidth) / 2 + i * (NODE.w + NODE.gapX), y: l * (NODE.h + NODE.gapY),
    }))
  })

  const missing: MissingState[] = []
  const routes = new Map<string, Frame[]>()
  for (const f of frames) if (f.route?.trim()) routes.set(f.route.trim(), [...(routes.get(f.route.trim()) ?? []), f])
  for (const [route, list] of [...routes].sort(([a], [b]) => a.localeCompare(b))) {
    const have = new Set(list.map((f) => stateOf(f).toLowerCase()))
    const near = list.find((f) => stateOf(f) === 'default') ?? list[0]!
    for (const state of EXPECTED_STATES) if (!have.has(state)) missing.push({ screen: route, route, state, near })
  }

  return {
    nodes, edges, missing, start: start?.id, width,
    height: packed.length ? packed.length * NODE.h + (packed.length - 1) * NODE.gapY : 0,
  }
}

/** What to ask an agent for to design a state a screen lacks. */
export function missingStateRequest(missing: Pick<MissingState, 'route' | 'state' | 'near'>[]) {
  const lines = missing.map((m, i) => `${i + 1}. The ${m.state} state of ${m.route}, based on “${m.near.name}” (frame ${m.near.id}).`)
  return [
    `Design ${missing.length === 1 ? 'a missing state' : `${missing.length} missing states`} for this prototype:`,
    ...lines,
    'For each, read the base frame with get_frame, then call create_sketch with the same width, height and route, and state set to the new state. Keep the layout, navigation and tokens of the base frame; change only what that state needs (a skeleton for loading, a helpful message and action for empty, a clear recovery for error).',
    'Link them where it makes sense, for example a retry button in the error state with data-zeko-goto set to the default frame’s id.',
  ].join('\n')
}

export { STATE_ORDER }
