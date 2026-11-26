import { createMcpHandler } from 'mcp-handler'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { boardPages, deckMembers, designGuidelines, framePage, frameSourceUrl, pageStart, visibleFrames } from '@/lib/ops'
import { defaultDesign, withDesignTokens } from '@/lib/tokens'
import { AsyncLocalStorage } from 'node:async_hooks'
import * as store from '@/lib/server/store'
import type { Actor, Board, Frame, Task } from '@/lib/types'
import { LIVE_FRAMES } from '@/lib/features'
import { inspect, screenshot } from '@/lib/server/render'
import { editLayers, inspectLayers, layerRevision } from '@/lib/server/layers'
import { MCP_AGENT_HEADER } from '@/lib/auth-access'

const INSTRUCTIONS = `Zeko is a light table for a product's screens. Each frame is a sketch: a whole HTML
document you write, labelled with the route and state it stands for.
Variants of one screen stack into a deck; the person flips through it and keeps one.

How to work:
1. Call get_board first. You are on the canvas the person has open (list_canvases shows the rest). Read the guidelines, open tasks and comments marked for agents.
   The board lists installed skills by description. Read a matching or explicitly requested skill with get_skill before starting that work.
   Use the task’s pageId as page_id when creating sketches. Review pinned references and use approved frames for implementation handoff.
   Reuse design tokens with CSS var(--name) so sketches follow the canvas’s active theme.
   Follow the guidelines (palette, type, voice, decisions). When the person settles something new, record it
   with update_guidelines so the next design follows it too.
2. Claim a task with claim_task, and say what you are doing with set_status as you go. If the task includes
   an element attachment, use its frameId, path, tag, name and text to find the element in the sketch.
   The path is made of zero-based child indexes from body, excluding script, style, meta, link, noscript,
   template, title and head elements. Confirm the tag and label before editing, since the sketch may have changed.
   For targeted changes, use get_layers to find the layer paths and revision, then edit_layers to save text, CSS, or structural changes in one batch.
3. For design work, call set_status as soon as you know what you are making. Publish the first real section
   early with create_sketch and streaming: true. Use a small, valid HTML document with inline CSS and put
   <!-- zeko:stream --> where the next section belongs. Call append_to_sketch with before set to that marker
   and one complete section at a time. Set done: true on the last section. Add or refine imagery after the
   layout is visible. For a redesign, use variant_of to add the draft to the existing frame's deck.
   Then look at what you made: screenshot_frame shows it rendered, inspect_frame lists element boxes, fonts,
   colors and whether the content overflows the frame. Fix what looks wrong before you report back.
   fit_frame_to_content sets the frame's height to the page's height. Every edit keeps the previous version,
   so list_versions and restore_version can undo a wrong turn.
4. Prototypes: make an element open another screen with data-zeko-goto="<frame id>" on it, or
   data-zeko-goto="back" to return. The person plays the screens from the board's start screen (flowStart).
   Frames with a "shape" are drawings on the canvas, not screens.
5. Finish with complete_task (one or two sentences on what changed and the IDs of the resulting frames) and answer comments with reply_to_comment.`

/* Each request works on one canvas: the one its URL names with ?board=ID, or the one the person opened last. */
interface CanvasScope {
  id: string
  dirty?: boolean
  presenceRequestId?: string | number
  run?: { taskId: string; runId: string }
}

const canvas = new AsyncLocalStorage<CanvasScope>()
const here = () => canvas.getStore()?.id ?? store.resolveId()
function requireCanvas() {
  const id = here()
  if (!id) throw new Error('Create or open a canvas in Zeko first.')
  return id
}
const getBoard = () => store.getBoard(requireCanvas())
const dispatch = (op: Parameters<typeof store.dispatch>[1], actor: Actor) => {
  const scope = canvas.getStore()
  if (scope && op.type !== 'agent.status' && op.type !== 'agent.connect') scope.dirty = true
  return store.dispatch(requireCanvas(), op, actor)
}

function canHandleTask(task: Task) {
  const run = canvas.getStore()?.run
  if (run) return task.id === run.taskId && task.localRun?.id === run.runId && !task.localRun.error
  return !task.localRun || !!task.localRun.error
}

function publicTask({ localRun: _localRun, thinking: _thinking, tools: _tools, ...task }: Task) {
  return task
}

function agentFrom(req: Request | undefined): Actor {
  let name = 'Agent'
  if (req) {
    const as = new URL(req.url).searchParams.get('as') ?? req.headers.get(MCP_AGENT_HEADER)
    if (as) name = as.slice(0, 40)
  }
  return { kind: 'agent', name }
}

type Ctx = { http?: { req?: Request } }

const layerPath = z.string().max(180).regex(/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))*$/)
const layerHtml = z.string().trim().min(1).max(100_000)
const layerPlacement = { parent_path: layerPath.optional(), before_path: layerPath.optional() }
const layerStyles = z.record(z.string().max(80).regex(/^(?:--[a-zA-Z0-9_-]+|-?[a-z][a-z0-9-]*)$/), z.string().max(2400).nullable())
  .refine((styles) => Object.keys(styles).length <= 40, 'Use up to 40 CSS properties per layer.')
const layerEdits = z.discriminatedUnion('op', [
  z.object({ op: z.literal('update'), path: layerPath, text: z.string().max(8000).optional(), styles: layerStyles.optional() }),
  z.object({ op: z.literal('insert'), html: layerHtml, ...layerPlacement }),
  z.object({ op: z.literal('move'), path: layerPath, ...layerPlacement }),
  z.object({ op: z.literal('replace'), path: layerPath, html: layerHtml }),
  z.object({ op: z.literal('remove'), path: layerPath }),
])

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] }
}

function fail(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] }
}

function touch(actor: Actor, message: string, frameId?: string, working = true) {
  dispatch({ type: 'agent.status', message, frameId, working }, actor)
}

function summarizeFrame(board: Board, f: Frame) {
  const deck = f.deckId ? deckMembers(board, f.deckId) : []
  return {
    id: f.id,
    name: f.name,
    kind: f.kind,
    pageId: framePage(board, f),
    approved: !!f.approved,
    reference: !!f.reference,
    shape: f.shape,
    route: f.route,
    state: f.state,
    size: `${f.w}x${f.h}`,
    position: { x: f.x, y: f.y },
    url: frameSourceUrl(f, board.appUrl),
    deck: f.deckId ? { id: f.deckId, variants: deck.map((d) => ({ id: d.id, name: d.name })) } : undefined,
  }
}

/** A spot to the right of everything, so new frames never land on top of others. */
function freeSpot(board: Board, pageId: string) {
  const frames = visibleFrames(board, pageId)
  if (frames.length === 0) return { x: 0, y: 0 }
  const right = Math.max(...frames.map((f) => f.x + f.w))
  const top = Math.min(...frames.map((f) => f.y))
  return { x: right + 120, y: top }
}

function targetPage(board: Board, actor: Actor, requested?: string) {
  const pages = boardPages(board)
  const first = pages[0]!.id
  if (requested) return pages.find((page) => page.id === requested)?.id
  const activePages = new Set(board.tasks.filter((task) => task.status === 'claimed' && task.claimedBy === actor.name).map((task) => task.pageId ?? first))
  const active = activePages.size === 1 ? [...activePages][0] : undefined
  return pages.find((page) => page.id === active)?.id ?? first
}

const handler = createMcpHandler(
  (server) => {
    const external = !canvas.getStore()?.run
    server.registerTool(
      'get_board',
      {
        title: 'Get board',
        description: 'Read the board: frames, design guidelines, installed skills, open tasks and comments meant for agents.',
        inputSchema: z.object({}),
      },
      async (_args: Record<string, never>, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        touch(actor, 'Reading the board', undefined, false)
        const board = getBoard()
        return text({
          board: board.name,
          canvasId: here(),
          flowStart: board.flowStart ?? null,
          pages: boardPages(board).map((page) => ({ ...page, flowStart: pageStart(board, page.id) ?? null })),
          guidelines: designGuidelines(board) || 'None yet. Ask the person, or infer from existing frames and save them with update_guidelines.',
          skills: (board.skills ?? []).map(({ id, title, description }) => ({ id, title, description })),
          design: board.design ?? defaultDesign,
          frames: visibleFrames(board).map((f) => summarizeFrame(board, f)),
          references: board.frames.filter((f) => f.reference).map((f) => summarizeFrame(board, f)),
          approvedFrames: board.frames.filter((f) => f.approved).map((f) => summarizeFrame(board, f)),
          openTasks: board.tasks
            .filter((task) => task.status !== 'done' && (!canvas.getStore()?.run || canHandleTask(task)))
            .map((task) => ({ ...publicTask(task), forYou: canHandleTask(task) && (!task.assignee || task.assignee === actor.name) })),
          commentsForAgents: board.comments
            .filter((c) => c.forAgents && !c.resolved)
            .map((c) => ({ id: c.id, frameId: c.frameId, text: c.text, at: { x: c.x, y: c.y }, replies: c.replies.map((r) => `${r.author.name}: ${r.text}`) })),
        })
      },
    )

    if (external) server.registerTool(
      'list_canvases',
      {
        title: 'List canvases',
        description:
          'Every canvas in this Zeko, with open request counts. You work on the canvas the person has open; to stay on one canvas, connect with ?board=<id> in the server URL.',
        inputSchema: z.object({}),
      },
      async () =>
        text({
          workingOn: here() || null,
          canvases: store.listBoards().map(({ id, name, frames, openTasks, updatedAt }) => ({ id, name, frames, openTasks, updatedAt: new Date(updatedAt).toISOString() })),
        }),
    )

    server.registerTool(
      'get_frame',
      {
        title: 'Get frame',
        description: 'Read one frame in full, including a sketch frame’s HTML.',
        inputSchema: z.object({ frame_id: z.string() }),
      },
      async ({ frame_id }: { frame_id: string }) => {
        const board = getBoard()
        const f = board.frames.find((x) => x.id === frame_id)
        if (!f) return fail(`No frame ${frame_id}. Call get_board for ids.`)
        return text({ ...summarizeFrame(board, f), versions: f.versions?.length ?? 0, html: f.html })
      },
    )

    server.registerTool(
      'create_sketch',
      {
        title: 'Create sketch',
        description:
          'Add a sketch from self-contained HTML. Set streaming: true to show work in progress, include the first visible section, and leave a unique <!-- zeko:stream --> marker for append_to_sketch. Use variant_of to add to an existing frame’s deck.',
        inputSchema: z.object({
          name: z.string().min(1).max(120),
          html: z.string().min(1),
          width: z.number().int().min(160).max(4000).default(1280),
          height: z.number().int().min(120).max(8000).default(800),
          route: z.string().optional(),
          state: z.string().optional(),
          page_id: z.string().optional(),
          variant_of: z.string().optional(),
          streaming: z.boolean().default(false),
        }),
      },
      async (args: { name: string; html: string; width: number; height: number; route?: string; state?: string; page_id?: string; variant_of?: string; streaming: boolean }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        const id = nanoid(10)
        let board = getBoard()
        if (args.variant_of) {
          if (!board.frames.some((f) => f.id === args.variant_of)) return fail(`No frame ${args.variant_of} to make a variant of.`)
          board = dispatch(
            {
              type: 'frame.variant',
              id: args.variant_of,
              newId: id,
              patch: { kind: 'sketch', name: args.name, html: args.html, url: undefined, route: args.route, state: args.state },
            },
            actor,
          )
        } else {
          const pageId = targetPage(board, actor, args.page_id)
          if (!pageId) return fail(`No page ${args.page_id}. Call get_board for page IDs.`)
          const spot = freeSpot(board, pageId)
          board = dispatch(
            { type: 'frame.create', frame: { id, pageId, name: args.name, kind: 'sketch', html: args.html, w: args.width, h: args.height, route: args.route, state: args.state, ...spot } },
            actor,
          )
        }
        touch(actor, args.streaming ? `Drawing ${args.name}` : `Sketched ${args.name}`, id, args.streaming)
        return text({ frame_id: id, deck: board.frames.find((f) => f.id === id)?.deckId ?? null })
      },
    )

    server.registerTool(
      'get_layers',
      {
        title: 'Get sketch layers',
        description: 'Read the authored layer tree of a sketch at its current size. Pass a path to inspect just that layer and its computed CSS. Returns a revision for edit_layers. Paths are the same zero-based child indexes used by the Design panel. Elements created by page scripts are outside the authored tree.',
        inputSchema: z.object({ frame_id: z.string(), path: layerPath.optional(), depth: z.number().int().min(1).max(8).default(3) }),
      },
      async ({ frame_id, path, depth }: { frame_id: string; path?: string; depth: number }) => {
        const board = getBoard()
        const frame = board.frames.find((f) => f.id === frame_id)
        if (!frame || frame.kind !== 'sketch' || frame.html === undefined) return fail(`No sketch ${frame_id}.`)
        const revision = layerRevision(frame.html)
        try {
          const result = await inspectLayers(withDesignTokens(frame.html, board.design), frame, depth, path)
          return text({ frame_id, revision, ...result })
        } catch (error) {
          return fail(error instanceof Error ? error.message : 'Could not read the sketch’s layers.')
        }
      },
    )

    server.registerTool(
      'edit_layers',
      {
        title: 'Edit sketch layers',
        description: 'Batch changes to individual layers of a sketch as one saved version. Update text or kebab-case CSS properties (null clears an inline property), insert or replace HTML, move, or remove a layer. Use the revision and paths from get_layers. Every path refers to the original tree for that revision. For insert and move, omit parent_path to use the body and omit before_path to append. Refresh the layer tree after a structural edit.',
        inputSchema: z.object({ frame_id: z.string(), revision: z.string().regex(/^[a-f0-9]{64}$/), edits: z.array(layerEdits).min(1).max(60) }),
      },
      async ({ frame_id, revision, edits }: { frame_id: string; revision: string; edits: z.infer<typeof layerEdits>[] }, ctx: Ctx) => {
        const frame = getBoard().frames.find((f) => f.id === frame_id)
        if (!frame || frame.kind !== 'sketch' || frame.html === undefined) return fail(`No sketch ${frame_id}.`)
        const source = frame.html
        const stale = 'The sketch changed. Call get_layers for the current revision and confirm the paths before retrying.'
        if (layerRevision(source) !== revision) return fail(stale)
        try {
          const result = await editLayers(source, edits)
          const current = getBoard().frames.find((f) => f.id === frame_id)
          if (!current || current.kind !== 'sketch' || current.html !== source) return fail(stale)
          if (result.html.length > 2_000_000) return fail('That sketch is over 2 MB. Split the design across frames.')
          const changed = result.html !== source
          if (changed) {
            const actor = agentFrom(ctx.http?.req)
            dispatch({ type: 'frame.update', id: frame_id, patch: { html: result.html } }, actor)
            touch(actor, `Edited layers in ${current.name}`, frame_id, false)
          }
          return text({ frame_id, revision: changed ? layerRevision(result.html) : revision, paths: result.paths, changed })
        } catch (error) {
          return fail(error instanceof Error ? error.message : 'Could not edit the sketch’s layers.')
        }
      },
    )

    server.registerTool(
      'edit_sketch',
      {
        title: 'Edit sketch',
        description:
          'Change a sketch frame’s HTML. Pass html to replace the whole document, or find and replace to swap one exact passage that occurs once.',
        inputSchema: z.object({
          frame_id: z.string(),
          html: z.string().optional(),
          find: z.string().optional(),
          replace: z.string().optional(),
        }),
      },
      async (args: { frame_id: string; html?: string; find?: string; replace?: string }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        const f = getBoard().frames.find((x) => x.id === args.frame_id)
        if (!f) return fail(`No frame ${args.frame_id}.`)
        if (f.kind === 'website') return fail(`${f.name} is an embedded website. Create a separate sketch to design from this reference.`)
        if (f.kind === 'live') return fail(`${f.name} is a live frame. Change the app’s code, or make a sketch variant.`)
        let html = args.html
        if (html === undefined) {
          if (args.find === undefined || args.replace === undefined) return fail('Pass html, or both find and replace.')
          const current = f.html ?? ''
          const count = current.split(args.find).length - 1
          if (count !== 1) return fail(`find must occur exactly once; it occurs ${count} times.`)
          html = current.replace(args.find, args.replace)
        }
        dispatch({ type: 'frame.update', id: f.id, patch: { html } }, actor)
        touch(actor, `Edited ${f.name}`, f.id, false)
        return text('Saved.')
      },
    )

    if (external && LIVE_FRAMES) server.registerTool(
      'add_live_frame',
      {
        title: 'Add live frame',
        description:
          'Add a live frame showing a running app. url is a full URL or a path resolved against the board’s app address. Use the state field (and a query string your app understands) to show a specific state. Set variant_of to put it in a deck.',
        inputSchema: z.object({
          name: z.string().min(1).max(120),
          url: z.string().min(1),
          width: z.number().int().min(160).max(4000).default(1280),
          height: z.number().int().min(120).max(8000).default(800),
          route: z.string().optional(),
          state: z.string().optional(),
          variant_of: z.string().optional(),
        }),
      },
      async (args: { name: string; url: string; width: number; height: number; route?: string; state?: string; variant_of?: string }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        const id = nanoid(10)
        const board = getBoard()
        const route = args.route ?? (args.url.startsWith('/') ? args.url.split('?')[0] : undefined)
        if (args.variant_of) {
          if (!board.frames.some((f) => f.id === args.variant_of)) return fail(`No frame ${args.variant_of}.`)
          dispatch(
            { type: 'frame.variant', id: args.variant_of, newId: id, patch: { kind: 'live', name: args.name, url: args.url, html: undefined, route, state: args.state } },
            actor,
          )
        } else {
          const pageId = targetPage(board, actor)
          if (!pageId) return fail('No page is available.')
          dispatch({ type: 'frame.create', frame: { id, pageId, name: args.name, kind: 'live', url: args.url, w: args.width, h: args.height, route, state: args.state, ...freeSpot(board, pageId) } }, actor)
        }
        touch(actor, `Added ${args.name}`, id, false)
        return text({ frame_id: id })
      },
    )

    server.registerTool(
      'append_to_sketch',
      {
        title: 'Append to sketch',
        description: 'Stream the next visible section into a sketch. Pass before to insert ahead of a unique marker such as <!-- zeko:stream -->, or omit it to append to the document. Set done on the final section.',
        inputSchema: z.object({
          frame_id: z.string(),
          html_chunk: z.string().min(1),
          before: z.string().min(1).optional(),
          done: z.boolean().default(false),
        }),
      },
      async (args: { frame_id: string; html_chunk: string; before?: string; done: boolean }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        const f = getBoard().frames.find((x) => x.id === args.frame_id)
        if (!f || f.kind !== 'sketch') return fail(`No sketch ${args.frame_id}.`)
        const current = f.html ?? ''
        const at = args.before ? current.indexOf(args.before) : current.length
        if (args.before && (at < 0 || at !== current.lastIndexOf(args.before))) return fail('before must occur exactly once in the sketch.')
        const html = current.slice(0, at) + args.html_chunk + current.slice(at)
        if (html.length > 2_000_000) return fail('That sketch is over 2 MB. Split the design across frames.')
        dispatch({ type: 'frame.update', id: f.id, patch: { html } }, actor)
        touch(actor, args.done ? `Sketched ${f.name}` : `Drawing ${f.name}`, f.id, !args.done)
        return text({ length: html.length })
      },
    )

    server.registerTool(
      'screenshot_frame',
      {
        title: 'Screenshot frame',
        description:
          'See a sketch frame rendered, as an image. Use it to check your work: spacing, contrast, text that wraps or overflows. full_page captures the whole document instead of only the frame’s size.',
        inputSchema: z.object({
          frame_id: z.string(),
          scale: z.number().min(0.25).max(2).default(1),
          full_page: z.boolean().default(false),
        }),
      },
      async (args: { frame_id: string; scale: number; full_page: boolean }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        const f = getBoard().frames.find((x) => x.id === args.frame_id)
        if (!f || f.kind !== 'sketch' || f.html === undefined) return fail(`No sketch ${args.frame_id}.`)
        touch(actor, `Checking ${f.name}`, f.id, true)
        try {
          const png = await screenshot(withDesignTokens(f.html, getBoard().design), { width: f.w, height: f.h, scale: args.scale, fullPage: args.full_page })
          return {
            content: [
              { type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' },
              { type: 'text' as const, text: `${f.name}, ${f.w}x${f.h}${args.full_page ? ', full page' : ''}` },
            ],
          }
        } catch (e) {
          return fail(e instanceof Error ? e.message : 'Rendering failed.')
        }
      },
    )

    server.registerTool(
      'inspect_frame',
      {
        title: 'Inspect frame',
        description:
          'Measure a rendered sketch: each element’s box [x, y, width, height], its text, the fonts and colors in use, the content’s full height, and whether it overflows the frame. Paths like "0.2.1" are child indexes from <body>.',
        inputSchema: z.object({ frame_id: z.string(), depth: z.number().int().min(1).max(12).default(6) }),
      },
      async (args: { frame_id: string; depth: number }) => {
        const f = getBoard().frames.find((x) => x.id === args.frame_id)
        if (!f || f.kind !== 'sketch' || f.html === undefined) return fail(`No sketch ${args.frame_id}.`)
        try {
          return text({ frame: `${f.w}x${f.h}`, ...(await inspect(withDesignTokens(f.html, getBoard().design), f.w, f.h, args.depth)) })
        } catch (e) {
          return fail(e instanceof Error ? e.message : 'Rendering failed.')
        }
      },
    )

    server.registerTool(
      'fit_frame_to_content',
      {
        title: 'Fit frame to content',
        description: 'Set a sketch frame’s height to its page’s full height, so nothing is cut off. Width stays as it is.',
        inputSchema: z.object({ frame_id: z.string() }),
      },
      async (args: { frame_id: string }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        const f = getBoard().frames.find((x) => x.id === args.frame_id)
        if (!f || f.kind !== 'sketch' || f.html === undefined) return fail(`No sketch ${args.frame_id}.`)
        try {
          const { contentHeight } = await inspect(withDesignTokens(f.html, getBoard().design), f.w, f.h, 1)
          const h = Math.min(8000, Math.max(120, contentHeight))
          dispatch({ type: 'frame.update', id: f.id, patch: { h } }, actor)
          return text({ width: f.w, height: h })
        } catch (e) {
          return fail(e instanceof Error ? e.message : 'Rendering failed.')
        }
      },
    )

    if (external) server.registerTool(
      'list_versions',
      {
        title: 'List versions',
        description: 'Earlier versions of a sketch’s HTML, oldest first. Each edit keeps the one before it.',
        inputSchema: z.object({ frame_id: z.string() }),
      },
      async (args: { frame_id: string }) => {
        const f = getBoard().frames.find((x) => x.id === args.frame_id)
        if (!f) return fail(`No frame ${args.frame_id}.`)
        return text((f.versions ?? []).map((v) => ({ at: v.at, when: new Date(v.at).toISOString(), by: v.by.name, length: v.html.length })))
      },
    )

    if (external) server.registerTool(
      'restore_version',
      {
        title: 'Restore version',
        description: 'Put an earlier version of a sketch back, by its `at` from list_versions. The current HTML is kept as a version too.',
        inputSchema: z.object({ frame_id: z.string(), at: z.number() }),
      },
      async (args: { frame_id: string; at: number }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        const f = getBoard().frames.find((x) => x.id === args.frame_id)
        if (!f?.versions?.some((v) => v.at === args.at)) return fail('No such version. Call list_versions.')
        dispatch({ type: 'frame.restoreVersion', id: f.id, at: args.at }, actor)
        return text('Restored.')
      },
    )

    if (external) server.registerTool(
      'delete_frame',
      {
        title: 'Delete frame',
        description: 'Remove a frame you created, such as a draft that went nowhere. Frames made by people stay.',
        inputSchema: z.object({ frame_id: z.string() }),
      },
      async (args: { frame_id: string }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        const f = getBoard().frames.find((x) => x.id === args.frame_id)
        if (!f) return fail(`No frame ${args.frame_id}.`)
        if (f.createdBy.kind !== 'agent' || f.createdBy.name !== actor.name) return fail(`${f.name} was made by ${f.createdBy.name}. Ask them before removing it.`)
        dispatch({ type: 'frame.delete', id: f.id }, actor)
        return text('Deleted.')
      },
    )

    server.registerTool(
      'get_skill',
      {
        title: 'Get skill',
        description: 'Read the instructions for an installed canvas skill. Use the skill ID from get_board when it matches the current request.',
        inputSchema: z.object({ skill_id: z.string().min(1).max(40) }),
      },
      async ({ skill_id }: { skill_id: string }) => {
        const skill = getBoard().skills?.find((item) => item.id === skill_id)
        return skill ? text({ title: skill.title, description: skill.description, instructions: skill.text }) : fail('Skill not found on this canvas.')
      },
    )

    server.registerTool(
      'get_guidelines',
      {
        title: 'Get guidelines',
        description: 'The board’s design guidelines: palette, type, voice and decisions already made.',
        inputSchema: z.object({}),
      },
      async () => text(designGuidelines(getBoard()) || 'No guidelines yet.'),
    )

    if (external) server.registerTool(
      'update_guidelines',
      {
        title: 'Update guidelines',
        description:
          'Change the canvas guidelines in Memory. mode "append" records a decision below the current guidelines; "replace" rewrites that entry. Named rules are managed in Memory.',
        inputSchema: z.object({ text: z.string().min(1).max(20000), mode: z.enum(['append', 'replace']).default('append') }),
      },
      async (args: { text: string; mode: 'append' | 'replace' }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        const current = getBoard().guidelines ?? ''
        const guidelines = args.mode === 'replace' || !current.trim() ? args.text : `${current.trimEnd()}\n${args.text}`
        dispatch({ type: 'board.update', guidelines }, actor)
        return text('Saved.')
      },
    )

    server.registerTool(
      'set_status',
      {
        title: 'Set status',
        description: 'Tell the people on the board what you are doing, in a few words. Name the frame you are working on.',
        inputSchema: z.object({ message: z.string().max(140), frame_id: z.string().optional(), done: z.boolean().default(false) }),
      },
      async (args: { message: string; frame_id?: string; done: boolean }, ctx: Ctx) => {
        touch(agentFrom(ctx.http?.req), args.message, args.frame_id, !args.done)
        return text('Shown on the board.')
      },
    )

    server.registerTool(
      'claim_task',
      {
        title: 'Claim task',
        description: 'Take an open task so no other agent starts it.',
        inputSchema: z.object({ task_id: z.string() }),
      },
      async ({ task_id }: { task_id: string }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        const task = getBoard().tasks.find((t) => t.id === task_id)
        if (!task) return fail(`No task ${task_id}.`)
        if (task.status === 'done') return fail('This request is already complete.')
        if (!canHandleTask(task)) return fail('This request belongs to a different run.')
        if (task.status === 'claimed' && task.claimedBy !== actor.name) return fail(`${task.claimedBy} already has this task.`)
        if (task.assignee && task.assignee !== actor.name) return fail(`This request is for ${task.assignee}. Leave it to them.`)
        dispatch({ type: 'task.claim', id: task_id }, actor)
        touch(actor, task.text.slice(0, 120), task.frameIds[0])
        return text({ task: publicTask(task), frames: task.frameIds })
      },
    )

    server.registerTool(
      'complete_task',
      {
        title: 'Complete task',
        description: 'Mark a task done. Include the IDs of the frames you created or changed so the person can jump to the result.',
        inputSchema: z.object({ task_id: z.string(), summary: z.string().max(600), result_frame_ids: z.array(z.string()).max(100).optional() }),
      },
      async ({ task_id, summary, result_frame_ids }: { task_id: string; summary: string; result_frame_ids?: string[] }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        const task = getBoard().tasks.find((item) => item.id === task_id)
        if (!task) return fail(`No task ${task_id}.`)
        if (!canHandleTask(task)) return fail('This request belongs to a different run.')
        if (canvas.getStore()?.run && task.status !== 'claimed') return fail('Claim this request before completing it.')
        dispatch({ type: 'task.complete', id: task_id, summary, resultFrameIds: result_frame_ids }, actor)
        touch(actor, 'Done', undefined, false)
        return text('Marked done.')
      },
    )

    if (external) server.registerTool(
      'reply_to_comment',
      {
        title: 'Reply to comment',
        description: 'Answer a comment thread. Set resolve when your change addresses it.',
        inputSchema: z.object({ comment_id: z.string(), text: z.string().min(1).max(2000), resolve: z.boolean().default(false) }),
      },
      async (args: { comment_id: string; text: string; resolve: boolean }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        if (!getBoard().comments.some((c) => c.id === args.comment_id)) return fail(`No comment ${args.comment_id}.`)
        dispatch({ type: 'comment.reply', id: args.comment_id, replyId: nanoid(10), text: args.text }, actor)
        if (args.resolve) dispatch({ type: 'comment.resolve', id: args.comment_id, resolved: true }, actor)
        return text('Replied.')
      },
    )
  },
  {
    serverInfo: { name: 'zeko', version: '0.1.0' },
    instructions: INSTRUCTIONS,
    onEvent(event) {
      if (event.type !== 'REQUEST_RECEIVED' || !['initialize', 'server/discover', 'ping', 'tools/list', 'tools/call'].includes(event.method)) return
      const scope = canvas.getStore()
      const id = (event.parameters as { id?: unknown } | undefined)?.id
      if (scope && !scope.run && (typeof id === 'string' || typeof id === 'number')) scope.presenceRequestId = id
    },
  },
)

/** A Streamable HTTP response can contain a JSON-RPC error even when HTTP status is 200. */
async function acceptedRequest(response: Response, id: string | number) {
  if (!response.ok) return false
  try {
    const text = await response.clone().text()
    const payloads = response.headers.get('content-type')?.includes('text/event-stream')
      ? [...text.matchAll(/^data:[ \t]*(\{[^\r\n]*\})\r?$/gm)].map((match) => match[1]!)
      : [text]
    return payloads.some((payload) => {
      const rpc = JSON.parse(payload) as { id?: unknown; result?: { isError?: boolean } }
      return rpc.id === id && rpc.result && typeof rpc.result === 'object' && !rpc.result.isError
    })
  } catch {
    return false
  }
}

async function route(request: Request) {
  const params = new URL(request.url).searchParams
  await store.prepareStore()
  const boardId = params.get('board')
  const empty = store.personalWorkspace() && !store.hasCanvases()
  const id = boardId ? store.hasBoard(boardId) ? boardId : null : empty ? '' : store.resolveId()
  if (id === null) return Response.json({ error: 'No such canvas. Leave out ?board= to work on the canvas the person has open.' }, { status: 404 })
  const scope: CanvasScope = { id }
  if (params.has('run')) {
    const taskId = params.get('task')
    const runId = params.get('run')
    const task = id ? store.getBoard(id).tasks.find((item) => item.id === taskId) : undefined
    if (!taskId || !runId || task?.status === 'done' || task?.localRun?.id !== runId || task.localRun.error || task.assignee !== agentFrom(request).name) {
      return Response.json({ error: 'This Zeko run is unavailable.' }, { status: 409 })
    }
    scope.run = { taskId, runId }
  }
  const response = await canvas.run(scope, () => handler(request))
  if (scope.dirty) await store.flushCanvas(id)
  const actor = agentFrom(request)
  if (scope.presenceRequestId !== undefined && store.needsMcpPresence(id, actor) &&
      await acceptedRequest(response, scope.presenceRequestId) && store.needsMcpPresence(id, actor)) {
    store.dispatch(id, { type: 'agent.connect' }, actor)
  }
  return response
}

export const GET = store.withWorkspace(route)
export const POST = GET
export const DELETE = GET
