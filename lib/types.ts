import type { AcpSelection, AcpToolActivity } from './acp'

export type ActorKind = 'human' | 'agent'

export interface Actor {
  kind: ActorKind
  name: string
}

export type FrameKind = 'live' | 'sketch' | 'website'

export interface Frame {
  id: string
  name: string
  kind: FrameKind
  x: number
  y: number
  w: number
  h: number
  /** Older boards belong to their first page. */
  pageId?: string
  approved?: boolean
  reference?: boolean
  /** Website address, or for live app frames a path relative to the board's app address. */
  url?: string
  /** sketch: a whole HTML document */
  html?: string
  /** the screen this frame shows, e.g. /checkout */
  route?: string
  /** the state of that screen, e.g. empty, error, loading */
  state?: string
  /** a shape drawn on the bare canvas: drawn without a frame's label or page, and left out of sheets and prototypes */
  shape?: ShapeKind
  /** Route associated with a text layer created by Arrange. */
  sheetRoute?: string
  /** frames sharing a deck id are variants of one another */
  deckId?: string
  /** set on the main copy of a component: editing this frame updates every instance */
  componentId?: string
  /** set on a capture of the implemented page: the design frame it builds */
  buildOf?: string
  /** where the build was captured from, so it can be captured again */
  buildUrl?: string
  /** how the build differs from its design, from the last check */
  drift?: DriftReport
  /** keys of differences people accepted as intentional; they stay accepted across checks */
  driftAccepted?: string[]
  /** earlier HTML of a sketch, newest last */
  versions?: Version[]
  createdBy: Actor
  createdAt: number
  updatedAt: number
}

export type ShapeKind = 'rect' | 'ellipse' | 'path' | 'text'

export type DriftKind = 'spacing' | 'size' | 'color' | 'token' | 'type' | 'text' | 'missing' | 'extra'

export interface DriftItem {
  /** stable across checks, so accepting a difference sticks */
  key: string
  kind: DriftKind
  /** what and where, e.g. Space above “Cancel anytime” */
  label: string
  design: string
  build: string
  /** a short instruction for whoever fixes the code */
  fix: string
  /** where to pin it on the build frame, from 0 to 1 */
  x: number
  y: number
  designPath?: string
  buildPath?: string
}

export interface DriftReport {
  checkedAt: number
  /** the design frame's updatedAt when checked, to tell when the check is out of date */
  designAt: number
  matched: number
  items: DriftItem[]
}

export interface Version {
  html: string
  at: number
  by: Actor
}

export interface Deck {
  front: string
}

export interface Reply {
  id: string
  author: Actor
  text: string
  at: number
}

export interface Comment {
  id: string
  frameId: string
  /** position inside the frame, 0..1 */
  x: number
  y: number
  author: Actor
  text: string
  forAgents: boolean
  resolved: boolean
  replies: Reply[]
  at: number
}

export type TaskStatus = 'open' | 'claimed' | 'done'

export interface TaskElement {
  frameId: string
  /** Zero-based layer indexes from the sketch's body. */
  path: string
  tag: string
  name: string
  text?: string
}

export interface Task {
  id: string
  chatId?: string
  acp?: AcpSelection
  pageId?: string
  text: string
  frameIds: string[]
  element?: TaskElement
  status: TaskStatus
  claimedBy?: string
  /** the agent this request is for; any agent may take it when unset */
  assignee?: string
  localRun?: { id: string; error?: string; message?: string }
  reply?: string
  thinking?: string
  tools?: AcpToolActivity[]
  summary?: string
  resultFrameIds?: string[]
  author: Actor
  at: number
  updatedAt: number
}

export interface AgentPresence {
  name: string
  message: string
  frameId?: string
  working: boolean
  lastSeen: number
  connectedAt?: number
  mcpConnectedAt?: number
  companion?: boolean
}

export interface Lane {
  label: string
  y: number
  pageId?: string
}

export interface BoardPage {
  id: string
  name: string
  flowStart?: string
}

export type TokenKind = 'color' | 'opacity' | 'radius' | 'spacing' | 'container' | 'breakpoint' | 'font-family' | 'font-weight' | 'font-size' | 'line-height' | 'letter-spacing'

export interface DesignToken {
  name: string
  kind: TokenKind
  values: Record<string, string>
}

export interface BoardDesign {
  themeId: string
  themes: { id: string; name: string }[]
  tokens: DesignToken[]
}

export interface SketchComponent {
  id: string
  name: string
  tag: string
  /** the main copy as a standalone document */
  html: string
  /** the element each instance becomes; its root carries data-zeko-instance="<id>" */
  body?: string
  w: number
  h: number
}

export interface Activity {
  id: string
  actor: Actor
  text: string
  at: number
}

export interface MemoryRule {
  id: string
  title: string
  text: string
}

export interface CanvasSkill {
  id: string
  title: string
  description: string
  text: string
  sourceUrl?: string
}

export interface Board {
  name: string
  appUrl: string
  pages?: BoardPage[]
  design?: BoardDesign
  components?: SketchComponent[]
  frames: Frame[]
  decks: Record<string, Deck>
  comments: Comment[]
  tasks: Task[]
  agents: Record<string, AgentPresence>
  lanes: Lane[]
  activity: Activity[]
  /** the board's design rules: palette, type, tone, decisions. Agents read these before designing. */
  guidelines?: string
  memoryRules?: MemoryRule[]
  skills?: CanvasSkill[]
  /** the screen a prototype starts on */
  flowStart?: string
  createdAt?: number
  /** last time a person or agent changed the canvas */
  updatedAt?: number
  version: number
}

export type FramePatch = Partial<Pick<Frame, 'name' | 'x' | 'y' | 'w' | 'h' | 'url' | 'html' | 'route' | 'state' | 'approved' | 'reference' | 'buildOf' | 'buildUrl' | 'drift' | 'driftAccepted'>>

export type Op =
  | { type: 'board.update'; name?: string; appUrl?: string; guidelines?: string; flowStart?: string; pageId?: string }
  | { type: 'memory.rule.save'; rule: MemoryRule }
  | { type: 'memory.rule.remove'; id: string }
  | { type: 'memory.skill.save'; skill: CanvasSkill }
  | { type: 'memory.skill.remove'; id: string }
  | { type: 'page.add'; id: string; name: string }
  | { type: 'page.rename'; id: string; name: string }
  | { type: 'page.remove'; id: string }
  | { type: 'page.moveFrames'; pageId: string; frameIds: string[] }
  | { type: 'design.theme.add'; id: string; name: string }
  | { type: 'design.theme.select'; id: string }
  | { type: 'design.token.set'; name: string; kind: TokenKind; themeId: string; value: string }
  | { type: 'design.token.remove'; name: string }
  | { type: 'component.save'; component: SketchComponent }
  | { type: 'component.remove'; id: string }
  /** Change a component's name or element; every instance follows. */
  | { type: 'component.update'; id: string; name?: string; body?: string }
  | { type: 'frame.create'; frame: Omit<Frame, 'createdBy' | 'createdAt' | 'updatedAt'> }
  | { type: 'frame.update'; id: string; patch: FramePatch }
  | { type: 'frame.delete'; id: string }
  | { type: 'frame.restoreVersion'; id: string; at: number }
  | { type: 'frame.variant'; id: string; newId: string; patch?: FramePatch & { kind?: FrameKind } }
  | { type: 'deck.front'; deckId: string; frameId: string }
  | { type: 'deck.keep'; frameId: string }
  | { type: 'sheet.arrange'; pageId?: string }
  | { type: 'comment.add'; comment: Pick<Comment, 'id' | 'frameId' | 'x' | 'y' | 'text' | 'forAgents'> }
  | { type: 'comment.reply'; id: string; replyId: string; text: string }
  | { type: 'comment.resolve'; id: string; resolved: boolean }
  | { type: 'comment.delete'; id: string }
  | { type: 'task.add'; id: string; text: string; frameIds: string[]; element?: TaskElement; assignee?: string; pageId?: string; chatId?: string; acp?: AcpSelection }
  | { type: 'task.claim'; id: string }
  | { type: 'task.run.start'; id: string; runId: string }
  | { type: 'task.run.message'; id: string; runId: string; message: string }
  | { type: 'task.run.stream'; id: string; runId: string; reply: string; thinking: string; tools: AcpToolActivity[] }
  | { type: 'task.run.close'; id: string; runId: string }
  | { type: 'task.run.fail'; id: string; runId: string; error: string }
  | { type: 'task.complete'; id: string; summary?: string; resultFrameIds?: string[] }
  | { type: 'task.delete'; id: string }
  | { type: 'agent.status'; message: string; frameId?: string; working: boolean }
  | { type: 'agent.connect' }
  | { type: 'batch'; ops: Op[] }
  | {
      /** Puts earlier versions back: how undo and redo are carried out. */
      type: 'restore'
      frames: Frame[]
      removeFrames: string[]
      comments: Comment[]
      removeComments: string[]
      decks: Record<string, Deck | null>
      board?: Partial<Pick<Board, 'name' | 'appUrl' | 'lanes' | 'guidelines' | 'memoryRules' | 'skills' | 'flowStart' | 'pages' | 'design' | 'components'>>
    }
