import { deckMembers } from './ops'
import type { Board, Frame } from './types'

export interface AlternateNode {
  frame: Frame
  /** the alternate it branched from; the first one has none */
  parent?: Frame
  /** how many branchings from the first one */
  depth: number
}

/**
 * The alternates of a frame as a tree: the deck it belongs to, each member under the one it branched from.
 * Members from before branching was recorded hang off the oldest member.
 */
export function alternateTree(board: Board, frame: Frame): AlternateNode[] {
  const members = frame.deckId ? deckMembers(board, frame.deckId) : [frame]
  const root = members[0]!
  const byId = new Map(members.map((m) => [m.id, m]))
  const parentOf = (m: Frame) => (m === root ? undefined : byId.get(m.variantOf ?? '') ?? root)
  const depthOf = new Map<string, number>()
  const depth = (m: Frame, seen = new Set<string>()): number => {
    const known = depthOf.get(m.id)
    if (known !== undefined) return known
    const parent = parentOf(m)
    const d = !parent || seen.has(m.id) ? 0 : (seen.add(m.id), depth(parent, seen) + 1)
    depthOf.set(m.id, d)
    return d
  }
  return members.map((m) => ({ frame: m, parent: parentOf(m), depth: depth(m) }))
}

/** Alternates grouped by generation: the original, what branched from it, and so on. */
export function generations(nodes: AlternateNode[]): AlternateNode[][] {
  const rows: AlternateNode[][] = []
  for (const node of nodes) (rows[node.depth] ??= []).push(node)
  return rows.filter(Boolean)
}

/** What to ask an agent for to get alternates of a frame. */
export function alternatesRequest(from: Pick<Frame, 'id' | 'name' | 'kind' | 'w' | 'h' | 'route' | 'state'>, count: number, direction: string) {
  const live = from.kind === 'live'
  return [
    `Make ${count} alternate${count === 1 ? '' : 's'} of the frame “${from.name}” (frame ${from.id}).`,
    direction.trim()
      ? `Direction: ${direction.trim()}`
      : 'Explore clearly different directions, for example in layout, hierarchy, density or visual style, while keeping the same content and purpose.',
    live
      ? `For each one, call add_live_frame with variant_of ${from.id}.`
      : `Read it with get_frame ${from.id}, then for each alternate call create_sketch with variant_of ${from.id}, width ${from.w}, height ${from.h}${from.route ? `, route ${from.route}` : ''}${from.state ? `, state ${from.state}` : ''}.`,
    'Name each one after its idea, such as “Compact grid” or “Bold header”, and keep them different from each other and from the original. Don’t change the original frame.',
  ].join('\n')
}
