import 'server-only'

import { z } from 'zod'
import { readAcpSelection } from '../acp'
import { readCanvasSkills } from '../canvas-skills'
import { readMemoryRules, readSketchComponents } from '../ops'
import { readDesign } from '../tokens'
import type { Board } from '../types'

const id = z.string().min(1)
const time = z.number().default(0)
const actor = z.object({ kind: z.enum(['human', 'agent']), name: z.string() })
const frame = z.object({
  id, name: z.string().default('Frame'), kind: z.enum(['sketch', 'live', 'website']),
  x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive(),
  pageId: id.optional(), approved: z.boolean().optional(), reference: z.boolean().optional(),
  url: z.string().optional(), html: z.string().optional(), route: z.string().optional(),
  state: z.string().optional(), shape: z.enum(['rect', 'ellipse', 'path', 'text']).optional(),
  sheetRoute: z.string().optional(), deckId: id.optional(),
  versions: z.array(z.object({ html: z.string(), at: time, by: actor })).optional(),
  createdBy: actor.default({ kind: 'human', name: 'You' }), createdAt: time, updatedAt: time,
})
const comment = z.object({
  id, frameId: id, x: z.number(), y: z.number(), author: actor, text: z.string(),
  forAgents: z.boolean().default(false), resolved: z.boolean().default(false), at: time,
  replies: z.array(z.object({ id, author: actor, text: z.string(), at: time })).default([]),
})
const task = z.object({
  id, text: z.string(), chatId: id.optional(), pageId: id.optional(),
  acp: z.unknown().optional().transform(readAcpSelection), frameIds: z.array(id).default([]),
  element: z.object({ frameId: id, path: z.string(), tag: z.string(), name: z.string(), text: z.string().optional() }).optional(),
  status: z.enum(['open', 'claimed', 'done']), claimedBy: z.string().optional(), assignee: z.string().optional(),
  localRun: z.object({ id, error: z.string().optional(), message: z.string().optional() }).optional(),
  reply: z.string().optional(), thinking: z.string().optional(),
  tools: z.array(z.object({ id, title: z.string(), status: z.enum(['pending', 'in_progress', 'completed', 'failed']) })).optional(),
  summary: z.string().optional(), resultFrameIds: z.array(id).optional(), author: actor, at: time, updatedAt: time,
})

function uniqueIds<T extends z.ZodType<{ id: string }>>(schema: T) {
  return z.array(schema).refine((entries) => new Set(entries.map((entry) => entry.id)).size === entries.length)
}

const board = z.object({
  name: z.string(), appUrl: z.string().default('http://localhost:3000'),
  pages: uniqueIds(z.object({ id, name: z.string(), flowStart: id.optional() })).optional(),
  frames: uniqueIds(frame), decks: z.record(id, z.object({ front: id })),
  comments: uniqueIds(comment), tasks: uniqueIds(task),
  guidelines: z.string().optional(), flowStart: id.optional(),
  lanes: z.array(z.object({ label: z.string(), y: z.number(), pageId: id.optional() })).default([]),
  activity: z.array(z.object({ id, actor, text: z.string(), at: time })).default([]),
  design: z.unknown().optional().transform(readDesign),
  components: z.unknown().optional().transform(readSketchComponents),
  memoryRules: z.unknown().optional().transform(readMemoryRules),
  skills: z.unknown().optional().transform(readCanvasSkills),
})

/** Share one import format across new canvases and replacements. */
export function readBoardImport(value: unknown): Board | undefined {
  const result = board.safeParse(value)
  if (result.success) return { ...result.data, agents: {}, version: 0 }
}
