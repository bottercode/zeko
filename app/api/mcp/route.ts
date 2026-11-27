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
import { componentFromLayer, editLayers, inspectLayers, layerAttributes, layerRevision } from '@/lib/server/layers'
import { checkSvg, compactImage, readSourceImage, sanitizeSvg } from '@/lib/server/assets'
import { snapshotPage } from '@/lib/server/snapshot'
import { SHADER_PRESETS, shaderLayerHtml, type ShaderPreset } from '@/lib/shaders'
import { componentDocument, countInstances } from '@/lib/components'
import { codeNotes, frameCode } from '@/lib/code'
import { captureBuild } from '@/lib/server/drift'
import { openDrift } from '@/lib/drift'
import { MCP_AGENT_HEADER } from '@/lib/auth-access'
import { DESIGN_BRIEF } from '@/lib/design-brief'

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
5. Images and drawings: Zeko makes none itself. Draw icons, illustrations and logos as SVG yourself and add them with
   place_svg. Make or find images with your own tools, then add them with place_image (a data URL or https address);
   to rework one, get_image shows you the current picture. Prefer real assets to placeholder boxes. add_shader adds an animated layer (mesh gradient, liquid, grain gradient,
   paper texture, halftone dots) that can be clipped, masked, rounded and blended with CSS like any element.
6. Components: create_component turns a layer into a reusable component; insert_component places instances;
   update_component changes the main copy and every instance follows. Reuse the board's components before
   drawing a repeated element again.
7. snapshot_url captures a live webpage as an editable sketch. get_frame_code hands a frame to implementation:
   its HTML or a React component, plus the tokens, fonts, images and components it relies on. When implementing
   a frame in a codebase, map those to the project's own theme, components and assets instead of pasting the markup.
8. Closing the loop on an implementation: once the page runs (for example on the dev server), call capture_build with
   the design frame and the page's URL. Zeko captures it beside the design and lists every difference (spacing, size,
   colors and tokens, type, copy, missing elements). Fix the code, call check_drift to capture again, and repeat until
   no open differences remain or the rest are intentional; say which and why.
9. Finish with complete_task (one or two sentences on what changed and the IDs of the resulting frames) and answer comments with reply_to_comment.

${DESIGN_BRIEF}`

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
const ATTRS_SCHEMA = z.record(z.string().max(80).regex(/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/), z.string().max(4_000_000).nullable())
  .refine((attrs) => Object.keys(attrs).length <= 20, 'Use up to 20 attributes per layer.')
const layerEdits = z.discriminatedUnion('op', [
  z.object({ op: z.literal('update'), path: layerPath, text: z.string().max(8000).optional(), styles: layerStyles.optional(), attrs: ATTRS_SCHEMA.optional() }),
  z.object({ op: z.literal('insert'), html: layerHtml, ...layerPlacement }),
  z.object({ op: z.literal('move'), path: layerPath, ...layerPlacement }),
  z.object({ op: z.literal('replace'), path: layerPath, html: layerHtml }),
  z.object({ op: z.literal('remove'), path: layerPath }),
])

const cssColor = z.string().trim().min(1).max(120).regex(/^[#\w\s(),.%/-]+$/, 'Use a CSS color such as #ff8a5b, oklch(70% 0.15 40) or var(--brand).')
const inlineCss = z.string().max(2000).regex(/^[^<>"{}]*$/, 'Use plain CSS declarations.')

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
    build: f.buildOf ? { of: f.buildOf, url: f.buildUrl, openDifferences: openDrift(f.drift?.items, f.driftAccepted).length } : undefined,
    builds: board.frames.filter((b) => b.buildOf === f.id).map((b) => ({ id: b.id, openDifferences: openDrift(b.drift?.items, b.driftAccepted).length })),
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
          components: (board.components ?? []).map((c) => ({
            id: c.id, name: c.name, tag: c.tag,
            mainFrameId: board.frames.find((f) => f.componentId === c.id)?.id ?? null,
            instances: board.frames.reduce((n, f) => n + (f.componentId ? 0 : countInstances(f.html, c.id)), 0),
          })),
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
        description: 'Batch changes to individual layers of a sketch as one saved version. Update text, kebab-case CSS properties (null clears an inline property) or attributes such as src, alt, href and data-* (null removes one), insert or replace HTML, move, or remove a layer. Use the revision and paths from get_layers. Every path refers to the original tree for that revision. For insert and move, omit parent_path to use the body and omit before_path to append. Refresh the layer tree after a structural edit.',
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
          'See a rendered sketch. Use JPEG for faster visual review or PNG for a lossless image. full_page captures the whole document instead of only the frame’s size.',
        inputSchema: z.object({
          frame_id: z.string(),
          scale: z.number().min(0.25).max(2).default(1),
          full_page: z.boolean().default(false),
          format: z.enum(['png', 'jpeg']).default('png'),
        }),
      },
      async (args: { frame_id: string; scale: number; full_page: boolean; format: 'png' | 'jpeg' }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        const f = getBoard().frames.find((x) => x.id === args.frame_id)
        if (!f || f.kind !== 'sketch' || f.html === undefined) return fail(`No sketch ${args.frame_id}.`)
        touch(actor, `Checking ${f.name}`, f.id, true)
        try {
          const image = await screenshot(withDesignTokens(f.html, getBoard().design), {
            width: f.w, height: f.h, scale: args.scale, fullPage: args.full_page, format: args.format,
          })
          return {
            content: [
              { type: 'image' as const, data: image.toString('base64'), mimeType: `image/${args.format}` },
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


    /** Puts HTML into a sketch as a new layer, reading the sketch as it is now, and returns the new layer's path. */
    async function insertLayer(frameId: string, html: string, placement: { parent_path?: string; before_path?: string }, actor: Actor, status: string) {
      const frame = getBoard().frames.find((f) => f.id === frameId)
      if (!frame || frame.kind !== 'sketch' || frame.html === undefined) throw new Error(`No sketch ${frameId}.`)
      const source = frame.html
      const result = await editLayers(source, [{ op: 'insert', html, ...placement }])
      if (getBoard().frames.find((f) => f.id === frameId)?.html !== source) throw new Error('The sketch changed meanwhile. Call get_layers and try again.')
      if (result.html.length > 2_000_000) throw new Error('That sketch would be over 2 MB. Use a smaller image or split the design across frames.')
      dispatch({ type: 'frame.update', id: frameId, patch: { html: result.html } }, actor)
      touch(actor, status, frameId, false)
      return result.paths[0] ?? null
    }

    async function updateLayer(frameId: string, path: string, attrs: Record<string, string | null>, actor: Actor, status: string) {
      const frame = getBoard().frames.find((f) => f.id === frameId)
      if (!frame || frame.kind !== 'sketch' || frame.html === undefined) throw new Error(`No sketch ${frameId}.`)
      const source = frame.html
      const result = await editLayers(source, [{ op: 'update', path, attrs }])
      if (getBoard().frames.find((f) => f.id === frameId)?.html !== source) throw new Error('The sketch changed meanwhile. Call get_layers and try again.')
      if (result.html.length > 2_000_000) throw new Error('That sketch would be over 2 MB. Use a smaller image.')
      dispatch({ type: 'frame.update', id: frameId, patch: { html: result.html } }, actor)
      touch(actor, status, frameId, false)
    }

    const sketch = (frameId: string) => {
      const frame = getBoard().frames.find((f) => f.id === frameId)
      return frame && frame.kind === 'sketch' && frame.html !== undefined ? frame : undefined
    }
    const failure = (error: unknown, fallback: string) => fail(error instanceof Error ? error.message : fallback)
    const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

    server.registerTool(
      'place_image',
      {
        title: 'Place image',
        description: 'Add an image you made or found with your own tools. src is a data URL (data:image/png;base64,…) or an https address; it is compressed and stored in the sketch. With frame_id and path, replace that <img> layer’s picture. With frame_id alone, add a new <img> layer (parent_path and before_path place it, as in edit_layers). Without frame_id, add the image as its own frame.',
        inputSchema: z.object({
          src: z.string().min(1).max(16_000_000),
          frame_id: z.string().optional(),
          path: layerPath.optional(),
          parent_path: layerPath.optional(),
          before_path: layerPath.optional(),
          width: z.number().int().min(16).max(4000).default(1024),
          height: z.number().int().min(16).max(4000).default(768),
          alt: z.string().max(300).default(''),
          name: z.string().min(1).max(120).optional(),
          page_id: z.string().optional(),
        }),
      },
      async (args: { src: string; frame_id?: string; path?: string; parent_path?: string; before_path?: string; width: number; height: number; alt: string; name?: string; page_id?: string }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        const target = args.frame_id ? sketch(args.frame_id) : undefined
        if (args.frame_id && !target) return fail(`No sketch ${args.frame_id}.`)
        try {
          if (target && args.path) {
            const layer = await layerAttributes(target.html!, args.path)
            if (layer.tag !== 'img') return fail(`Layer ${args.path} is a <${layer.tag}>. Pass the path of an <img>, or leave path out and use parent_path to add one.`)
          }
          const image = await readSourceImage(args.src.trim())
          if (!/^image\/(png|jpe?g|webp|gif|avif|svg\+xml)$/.test(image.mediaType)) return fail(`Use a PNG, JPEG, WebP, GIF, AVIF or SVG image, not ${image.mediaType}.`)
          const src = await compactImage(image, args.width, args.height)
          if (target && args.path) {
            await updateLayer(target.id, args.path, { src, ...(args.alt ? { alt: args.alt } : {}) }, actor, 'Placed an image')
            return text({ frame_id: target.id, path: args.path })
          }
          if (target) {
            const path = await insertLayer(target.id, `<img src="${src}" alt="${escapeAttr(args.alt)}" style="display:block;width:100%;max-width:${args.width}px;height:auto;object-fit:cover">`,
              { parent_path: args.parent_path, before_path: args.before_path }, actor, 'Placed an image')
            return text({ frame_id: target.id, path })
          }
          const board = getBoard()
          const pageId = targetPage(board, actor, args.page_id)
          if (!pageId) return fail(`No page ${args.page_id}. Call get_board for page IDs.`)
          const id = nanoid(10)
          const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh"><img src="${src}" alt="${escapeAttr(args.alt)}" style="display:block;width:100%;height:100%;object-fit:cover"></body></html>`
          dispatch({ type: 'frame.create', frame: { id, pageId, kind: 'sketch', name: args.name ?? 'Image', html, w: args.width, h: args.height, ...freeSpot(board, pageId) } }, actor)
          touch(actor, 'Placed an image', id, false)
          return text({ frame_id: id })
        } catch (error) {
          return failure(error, 'Could not place the image.')
        }
      },
    )

    server.registerTool(
      'get_image',
      {
        title: 'Get image',
        description: 'See the picture in an <img> layer, to describe it or rework it with your own tools before placing the result with place_image.',
        inputSchema: z.object({ frame_id: z.string(), path: layerPath }),
      },
      async (args: { frame_id: string; path: string }) => {
        const target = sketch(args.frame_id)
        if (!target) return fail(`No sketch ${args.frame_id}.`)
        try {
          const layer = await layerAttributes(target.html!, args.path)
          if (layer.tag !== 'img' || !layer.attrs.src) return fail(`Layer ${args.path} is not an image with a src.`)
          const image = await readSourceImage(layer.attrs.src)
          if (!/^image\/(png|jpe?g|webp|gif)$/.test(image.mediaType)) return text({ src: layer.attrs.src.slice(0, 2000), note: `The image is ${image.mediaType}, which can’t be shown inline.` })
          return {
            content: [
              { type: 'image' as const, data: Buffer.from(image.data).toString('base64'), mimeType: image.mediaType },
              { type: 'text' as const, text: JSON.stringify({ alt: layer.attrs.alt ?? '', mediaType: image.mediaType, bytes: image.data.byteLength }) },
            ],
          }
        } catch (error) {
          return failure(error, 'Could not read the image.')
        }
      },
    )

    server.registerTool(
      'place_svg',
      {
        title: 'Place SVG',
        description: 'Add an icon, logo, illustration or pattern you drew as SVG. Scripts, event handlers and external references are removed. With frame_id and path, replace that layer; otherwise add a layer (parent_path and before_path place it). Use a viewBox, and currentColor for icons that should follow the text color.',
        inputSchema: z.object({
          svg: z.string().min(1).max(400_000),
          frame_id: z.string(),
          path: layerPath.optional(),
          parent_path: layerPath.optional(),
          before_path: layerPath.optional(),
          width: z.number().int().min(4).max(4000).default(240),
          height: z.number().int().min(4).max(4000).default(240),
        }),
      },
      async (args: { svg: string; frame_id: string; path?: string; parent_path?: string; before_path?: string; width: number; height: number }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        if (!sketch(args.frame_id)) return fail(`No sketch ${args.frame_id}.`)
        try {
          const clean = sanitizeSvg(args.svg)
          await checkSvg(clean)
          const sized = clean.replace(/<svg/i, `<svg style="display:block;width:${args.width}px;height:${args.height}px;max-width:100%"`)
          if (args.path) {
            const frame = sketch(args.frame_id)!
            const source = frame.html!
            const result = await editLayers(source, [{ op: 'replace', path: args.path, html: sized }])
            if (getBoard().frames.find((f) => f.id === frame.id)?.html !== source) return fail('The sketch changed meanwhile. Call get_layers and try again.')
            dispatch({ type: 'frame.update', id: frame.id, patch: { html: result.html } }, actor)
            touch(actor, 'Placed an SVG', frame.id, false)
            return text({ frame_id: frame.id, path: args.path })
          }
          const path = await insertLayer(args.frame_id, sized, { parent_path: args.parent_path, before_path: args.before_path }, actor, 'Placed an SVG')
          return text({ frame_id: args.frame_id, path })
        } catch (error) {
          return failure(error, 'Could not place the SVG.')
        }
      },
    )

    server.registerTool(
      'add_shader',
      {
        title: 'Add shader layer',
        description: `Add an animated WebGL layer to a sketch: ${Object.entries(SHADER_PRESETS).map(([id, p]) => `${id} (${p.description})`).join('; ')}. It is a <canvas data-zeko-shader> element: size and place it with style, and clip, mask, round or blend it with CSS like any layer. Colors accept var(--token). speed 0 keeps a still frame. Change it later with edit_layers attrs (data-colors as "c1;c2;c3;c4", data-speed, data-scale, data-amount, data-grain, data-seed).`,
        inputSchema: z.object({
          frame_id: z.string(),
          preset: z.enum(Object.keys(SHADER_PRESETS) as [ShaderPreset, ...ShaderPreset[]]),
          colors: z.array(cssColor).min(1).max(4).optional(),
          speed: z.number().min(0).max(3).optional(),
          scale: z.number().min(0.25).max(4).optional(),
          amount: z.number().min(0).max(1).optional(),
          grain: z.number().min(0).max(1).optional(),
          seed: z.number().min(0).max(1000).optional(),
          style: inlineCss.default('display:block;width:100%;height:480px'),
          parent_path: layerPath.optional(),
          before_path: layerPath.optional(),
        }),
      },
      async (args: { frame_id: string; preset: ShaderPreset; colors?: string[]; speed?: number; scale?: number; amount?: number; grain?: number; seed?: number; style: string; parent_path?: string; before_path?: string }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        if (!sketch(args.frame_id)) return fail(`No sketch ${args.frame_id}.`)
        const defaults = SHADER_PRESETS[args.preset].defaults
        const params = {
          preset: args.preset, colors: args.colors ?? defaults.colors, speed: args.speed ?? defaults.speed, scale: args.scale ?? defaults.scale,
          amount: args.amount ?? defaults.amount, grain: args.grain ?? defaults.grain, seed: args.seed ?? defaults.seed,
        }
        try {
          const path = await insertLayer(args.frame_id, shaderLayerHtml(params, args.style.replace(/;\s*$/, '')), { parent_path: args.parent_path, before_path: args.before_path }, actor, `Added a ${SHADER_PRESETS[args.preset].label.toLowerCase()}`)
          return text({ frame_id: args.frame_id, path, note: 'Put content above it with position or a grid stack; screenshot_frame shows the CSS stand-in where WebGL is unavailable.' })
        } catch (error) {
          return failure(error, 'Could not add the shader.')
        }
      },
    )

    server.registerTool(
      'create_component',
      {
        title: 'Create component',
        description: 'Turn a layer into a reusable component. Its look is captured with inline styles so it holds up in any sketch, and the layer becomes the first instance.',
        inputSchema: z.object({ frame_id: z.string(), path: layerPath, name: z.string().min(1).max(120) }),
      },
      async (args: { frame_id: string; path: string; name: string }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        const target = sketch(args.frame_id)
        if (!target) return fail(`No sketch ${args.frame_id}.`)
        const id = nanoid(10)
        try {
          const captured = await componentFromLayer(withDesignTokens(target.html!, getBoard().design), target, args.path, id)
          dispatch({ type: 'component.save', component: { id, name: args.name, tag: captured.tag, body: captured.body, html: componentDocument(captured.body), w: captured.w, h: captured.h } }, actor)
          await updateLayer(target.id, args.path, { 'data-zeko-instance': id }, actor, `Made ${args.name} a component`)
          return text({ component_id: id })
        } catch (error) {
          return failure(error, 'Could not create the component.')
        }
      },
    )

    server.registerTool(
      'get_component',
      {
        title: 'Get component',
        description: 'Read a component: the HTML each instance uses, its size and where it is used.',
        inputSchema: z.object({ component_id: z.string() }),
      },
      async ({ component_id }: { component_id: string }) => {
        const board = getBoard()
        const component = board.components?.find((c) => c.id === component_id)
        if (!component) return fail(`No component ${component_id}. Call get_board for component IDs.`)
        return text({
          id: component.id, name: component.name, tag: component.tag, size: `${component.w}x${component.h}`,
          html: component.body ?? null,
          mainFrameId: board.frames.find((f) => f.componentId === component.id)?.id ?? null,
          usedIn: board.frames.filter((f) => !f.componentId && countInstances(f.html, component.id)).map((f) => ({ frame_id: f.id, name: f.name, instances: countInstances(f.html, component.id) })),
        })
      },
    )

    server.registerTool(
      'insert_component',
      {
        title: 'Insert component',
        description: 'Place an instance of a component in a sketch. parent_path and before_path place it, as in edit_layers. Instances follow their component when it changes.',
        inputSchema: z.object({ frame_id: z.string(), component_id: z.string(), parent_path: layerPath.optional(), before_path: layerPath.optional() }),
      },
      async (args: { frame_id: string; component_id: string; parent_path?: string; before_path?: string }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        const component = getBoard().components?.find((c) => c.id === args.component_id)
        if (!component?.body) return fail(`No component ${args.component_id} with an element to place. Call get_board for component IDs.`)
        try {
          const path = await insertLayer(args.frame_id, component.body, { parent_path: args.parent_path, before_path: args.before_path }, actor, `Placed ${component.name}`)
          return text({ frame_id: args.frame_id, path })
        } catch (error) {
          return failure(error, 'Could not place the component.')
        }
      },
    )

    server.registerTool(
      'update_component',
      {
        title: 'Update component',
        description: 'Change a component everywhere: html replaces the element every instance uses (one root element; keep inline styles so it works in any sketch), name renames it.',
        inputSchema: z.object({ component_id: z.string(), html: z.string().min(1).max(500_000).optional(), name: z.string().min(1).max(120).optional() }),
      },
      async (args: { component_id: string; html?: string; name?: string }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        const board = getBoard()
        if (!board.components?.some((c) => c.id === args.component_id)) return fail(`No component ${args.component_id}.`)
        if (!args.html && !args.name) return fail('Pass html, name, or both.')
        if (args.html && !/^\s*<[a-zA-Z]/.test(args.html)) return fail('html must be one element, starting with its opening tag.')
        dispatch({ type: 'component.update', id: args.component_id, name: args.name, body: args.html }, actor)
        const after = getBoard()
        const instances = after.frames.reduce((n, f) => n + (f.componentId ? 0 : countInstances(f.html, args.component_id)), 0)
        touch(actor, 'Updated a component', undefined, false)
        return text({ updated: true, instances })
      },
    )

    server.registerTool(
      'snapshot_url',
      {
        title: 'Snapshot webpage',
        description: 'Capture a live webpage as an editable sketch: every element becomes a layer with its rendered styles written inline. Use it to iterate on an existing site or product screen. Pages behind a login are not reachable.',
        inputSchema: z.object({
          url: z.string().url().max(2048),
          name: z.string().min(1).max(120).optional(),
          width: z.number().int().min(320).max(2560).default(1280),
          height: z.number().int().min(320).max(4000).default(800),
          route: z.string().optional(),
          page_id: z.string().optional(),
        }),
      },
      async (args: { url: string; name?: string; width: number; height: number; route?: string; page_id?: string }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        try {
          touch(actor, `Capturing ${new URL(args.url).hostname}`, undefined, true)
          const shot = await snapshotPage(args.url, args.width, args.height)
          const board = getBoard()
          const pageId = targetPage(board, actor, args.page_id)
          if (!pageId) return fail(`No page ${args.page_id}. Call get_board for page IDs.`)
          const id = nanoid(10)
          dispatch({ type: 'frame.create', frame: { id, pageId, kind: 'sketch', name: args.name ?? shot.title, html: shot.html, w: args.width, h: Math.max(args.height, shot.height), route: args.route, ...freeSpot(board, pageId) } }, actor)
          touch(actor, `Captured ${shot.title}`, id, false)
          return text({ frame_id: id, title: shot.title, height: Math.max(args.height, shot.height) })
        } catch (error) {
          touch(actor, 'Snapshot failed', undefined, false)
          return failure(error, 'Could not capture that page.')
        }
      },
    )

    server.registerTool(
      'get_frame_code',
      {
        title: 'Get frame code',
        description: 'Hand a sketch to implementation: its HTML or a React component (JSX with style objects), with the canvas tokens defined, plus notes on the fonts, design tokens, images, shaders and components it relies on. Map those to the codebase’s own theme, components and assets rather than pasting the markup as is.',
        inputSchema: z.object({ frame_id: z.string(), format: z.enum(['html', 'react']).default('react') }),
      },
      async (args: { frame_id: string; format: 'html' | 'react' }) => {
        const board = getBoard()
        const frame = board.frames.find((f) => f.id === args.frame_id)
        if (!frame || frame.kind !== 'sketch' || frame.html === undefined) return fail(`No sketch ${args.frame_id}.`)
        const notes = codeNotes(frame.html)
        return text({
          frame: summarizeFrame(board, frame),
          format: args.format,
          code: frameCode(frame.html, frame.name, board.design, args.format),
          tokens: (board.design?.tokens ?? []).filter((token) => notes.tokens.includes(token.name)),
          fonts: notes.fonts,
          images: { embedded: notes.embeddedImages, linked: notes.linkedImages, note: notes.embeddedImages ? 'Embedded images are data URLs: save them as asset files in the project.' : undefined },
          shaders: notes.shaders.length ? { presets: notes.shaders, note: 'Shader layers are drawn by the inline zeko-shaders script; port it or replace them with the project’s own effect.' } : undefined,
          components: notes.componentIds.map((id) => ({ id, name: board.components?.find((c) => c.id === id)?.name })).filter((c) => c.name),
        })
      },
    )


    /** A drift report written for an agent: each open difference with what to change in the code. */
    const driftText = (result: Awaited<ReturnType<typeof captureBuild>>) => {
      const open = openDrift(result.drift.items, result.build.driftAccepted)
      return text({
        build_frame_id: result.build.id,
        design_frame_id: result.design.id,
        url: result.build.buildUrl,
        matched_elements: result.drift.matched,
        open_differences: open.length,
        accepted_as_intentional: result.drift.items.length - open.length,
        differences: open.map((item, i) => ({ n: i + 1, kind: item.kind, where: item.label, design: item.design, build: item.build, fix: item.fix })),
        next: open.length
          ? 'Fix these in the codebase, then call check_drift to capture the page again.'
          : result.drift.matched < 3
            ? 'Few elements matched: check that the URL shows the page this design is for.'
            : 'The build matches the design.',
      })
    }

    server.registerTool(
      'capture_build',
      {
        title: 'Capture build',
        description: 'Capture the page that implements a design frame (for example http://localhost:3000/pricing on the dev server) beside the design, and check it for drift: spacing, sizes, colors and design tokens, type, copy, and missing or extra elements. Returns each difference with the change to make in code. Capturing again for the same design and URL updates the existing build frame.',
        inputSchema: z.object({
          design_frame_id: z.string(),
          url: z.string().min(1).max(2048),
          name: z.string().min(1).max(120).optional(),
        }),
      },
      async (args: { design_frame_id: string; url: string; name?: string }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        const same = getBoard().frames.find((f) => f.buildOf === args.design_frame_id && f.buildUrl === args.url.trim())
        try {
          touch(actor, 'Capturing the build', args.design_frame_id, true)
          const result = await captureBuild({ board: getBoard, apply: (op) => { dispatch(op, actor) } }, { designId: args.design_frame_id, buildId: same?.id, url: args.url, name: args.name })
          touch(actor, `Checked the build: ${openDrift(result.drift.items, result.build.driftAccepted).length} open differences`, result.build.id, false)
          return driftText(result)
        } catch (error) {
          touch(actor, 'Build capture failed', args.design_frame_id, false)
          const message = error instanceof Error ? error.message : 'Could not capture the build.'
          return fail(process.env.ZEKO_HOSTED === '1' && /private network/i.test(message)
            ? `${message} Hosted Zeko can’t reach the dev server on this computer: deploy a preview and capture that URL instead.`
            : message)
        }
      },
    )

    server.registerTool(
      'check_drift',
      {
        title: 'Check drift',
        description: 'Capture a build frame again from its URL (after fixing the code) and list the differences that are still open. Differences people accepted as intentional are left out.',
        inputSchema: z.object({ build_frame_id: z.string(), recapture: z.boolean().default(true) }),
      },
      async (args: { build_frame_id: string; recapture: boolean }, ctx: Ctx) => {
        const actor = agentFrom(ctx.http?.req)
        const build = getBoard().frames.find((f) => f.id === args.build_frame_id)
        if (!build?.buildOf) return fail(`${args.build_frame_id} is not a build frame. Call capture_build first.`)
        try {
          touch(actor, 'Checking the build', build.id, true)
          const result = await captureBuild({ board: getBoard, apply: (op) => { dispatch(op, actor) } }, { buildId: build.id, recapture: args.recapture })
          touch(actor, `Checked the build: ${openDrift(result.drift.items, result.build.driftAccepted).length} open differences`, build.id, false)
          return driftText(result)
        } catch (error) {
          touch(actor, 'Drift check failed', build.id, false)
          return failure(error, 'Could not check the build.')
        }
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
