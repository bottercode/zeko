'use client'

import { useEffect, useRef } from 'react'
import { boardPages, visibleFrames } from '../ops'
import { frameCode } from '../code'
import { newId } from './useBoard'
import type { StudioState } from '@/components/studio-context'
import type { TokenKind } from '../types'
import { tokenLabels } from '../tokens'

/*
 * WebMCP: the open canvas offers tools to AI agents running in the browser, through navigator.modelContext.
 * Browsers without WebMCP skip this. Tools act through the same operations a person's clicks do, so undo,
 * history and live updates work the same way.
 */

interface ToolResult { content: { type: 'text'; text: string }[]; isError?: boolean }

interface WebTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean }
  execute: (input: Record<string, unknown>) => Promise<ToolResult>
}

interface ModelContext {
  registerTool?: (tool: WebTool) => { unregister?: () => void } | undefined | void
  unregisterTool?: (name: string) => void
  provideContext?: (context: { tools: WebTool[] }) => void
  clearContext?: () => void
}

const ok = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] })
const err = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true })
const str = (value: unknown) => (typeof value === 'string' ? value : undefined)
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })

function tools(get: () => StudioState): WebTool[] {
  const frameById = (id: unknown) => get().board.frames.find((frame) => frame.id === id)
  const summary = (id: string) => {
    const f = frameById(id)
    return f && { id: f.id, name: f.name, kind: f.kind, route: f.route, state: f.state, size: `${f.w}x${f.h}`, approved: !!f.approved, componentId: f.componentId }
  }
  return [
    {
      name: 'zeko_get_canvas',
      description: 'Read the open Zeko canvas: its pages, the frames on the current page, the selection, design tokens, components, guidelines and open requests.',
      inputSchema: object({}),
      annotations: { readOnlyHint: true },
      async execute() {
        const { board, pageId, selection } = get()
        return ok({
          name: board.name,
          page: boardPages(board).find((page) => page.id === pageId),
          pages: boardPages(board),
          frames: visibleFrames(board, pageId).map((f) => summary(f.id)),
          selection,
          guidelines: board.guidelines ?? '',
          tokens: board.design?.tokens ?? [],
          components: (board.components ?? []).map(({ id, name, tag }) => ({ id, name, tag })),
          openRequests: board.tasks.filter((task) => task.status !== 'done').map(({ id, text, status, frameIds }) => ({ id, text, status, frameIds })),
        })
      },
    },
    {
      name: 'zeko_get_selection',
      description: 'What the person has selected: frames, and inside a sketch being edited, the selected element with its styles.',
      inputSchema: object({}),
      annotations: { readOnlyHint: true },
      async execute() {
        const { selection, element, interactId } = get()
        return ok({
          frames: selection.map(summary).filter(Boolean),
          editingFrameId: interactId,
          element: element && { path: element.path, tag: element.tag, name: element.name, text: element.text, size: element.rect, style: element.style },
        })
      },
    },
    {
      name: 'zeko_get_frame',
      description: 'Read one frame, including a sketch’s whole HTML document.',
      inputSchema: object({ frame_id: { type: 'string' } }, ['frame_id']),
      annotations: { readOnlyHint: true },
      async execute({ frame_id }) {
        const f = frameById(frame_id)
        return f ? ok({ ...summary(f.id), html: f.html }) : err(`No frame ${String(frame_id)}.`)
      },
    },
    {
      name: 'zeko_create_sketch',
      description: 'Add a sketch frame from a complete, self-contained HTML document, placed beside the frames on the current page, and select it. Use var(--token) for the canvas’s design tokens.',
      inputSchema: object({
        name: { type: 'string' }, html: { type: 'string' },
        width: { type: 'number', default: 1280 }, height: { type: 'number', default: 800 },
        route: { type: 'string' }, state: { type: 'string' },
      }, ['name', 'html']),
      async execute(input) {
        const s = get()
        const name = str(input.name)?.trim().slice(0, 120)
        const html = str(input.html)
        if (!name || !html) return err('Pass a name and an HTML document.')
        if (html.length > 2_000_000) return err('That sketch is over 2 MB.')
        const frames = visibleFrames(s.board, s.pageId)
        const x = frames.length ? Math.max(...frames.map((f) => f.x + f.w)) + 120 : 0
        const y = frames.length ? Math.min(...frames.map((f) => f.y)) : 0
        const w = Math.min(4000, Math.max(160, Math.round(num(input.width) ?? 1280)))
        const h = Math.min(8000, Math.max(120, Math.round(num(input.height) ?? 800)))
        const id = newId()
        const frame = { id, pageId: s.pageId, kind: 'sketch' as const, name, html, x, y, w, h, route: str(input.route), state: str(input.state) }
        s.dispatch({ type: 'frame.create', frame })
        s.select([id])
        s.flyTo({ ...frame, createdAt: 0, updatedAt: 0, createdBy: { kind: 'agent', name: 'Browser agent' } })
        return ok({ frame_id: id })
      },
    },
    {
      name: 'zeko_edit_sketch',
      description: 'Change a sketch’s HTML: pass html to replace the document, or find and replace to swap one passage that occurs exactly once. Each edit keeps the previous version.',
      inputSchema: object({ frame_id: { type: 'string' }, html: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' } }, ['frame_id']),
      async execute(input) {
        const f = frameById(input.frame_id)
        if (!f || f.kind !== 'sketch') return err(`No sketch ${String(input.frame_id)}.`)
        let html = str(input.html)
        if (html === undefined) {
          const find = str(input.find)
          const replace = str(input.replace)
          if (find === undefined || replace === undefined) return err('Pass html, or both find and replace.')
          const count = (f.html ?? '').split(find).length - 1
          if (count !== 1) return err(`find must occur exactly once; it occurs ${count} times.`)
          html = (f.html ?? '').replace(find, () => replace)
        }
        get().dispatch({ type: 'frame.update', id: f.id, patch: { html } })
        return ok('Saved.')
      },
    },
    {
      name: 'zeko_style_selected_element',
      description: 'Set CSS properties on the element selected in the sketch being edited, such as {"color": "var(--brand)", "padding": "16px"}. An empty value clears a property.',
      inputSchema: object({ styles: { type: 'object', additionalProperties: { type: 'string' } } }, ['styles']),
      async execute(input) {
        const { element, toFrame } = get()
        if (!element) return err('No element is selected. Ask the person to open a sketch and pick an element.')
        const styles = Object.fromEntries(Object.entries((input.styles ?? {}) as Record<string, unknown>).filter(([key, value]) => /^-?-?[a-z][a-z0-9-]*$/.test(key) && typeof value === 'string')) as Record<string, string>
        if (!Object.keys(styles).length) return err('Pass styles as kebab-case CSS properties with string values.')
        toFrame({ type: 'apply', path: element.path, style: styles })
        return ok({ path: element.path, applied: Object.keys(styles) })
      },
    },
    {
      name: 'zeko_select_frame',
      description: 'Select a frame and move the view to it.',
      inputSchema: object({ frame_id: { type: 'string' } }, ['frame_id']),
      async execute({ frame_id }) {
        const f = frameById(frame_id)
        if (!f) return err(`No frame ${String(frame_id)}.`)
        get().select([f.id])
        get().flyTo(f)
        return ok(`Showing ${f.name}.`)
      },
    },
    {
      name: 'zeko_add_comment',
      description: 'Pin a comment on a frame. x and y are its position inside the frame, from 0 to 1. Set for_agents so Zeko’s design agents pick it up.',
      inputSchema: object({ frame_id: { type: 'string' }, text: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, for_agents: { type: 'boolean' } }, ['frame_id', 'text']),
      async execute(input) {
        const f = frameById(input.frame_id)
        const text = str(input.text)?.trim()
        if (!f || !text) return err('Pass an existing frame_id and the comment text.')
        const clamp = (v: number | undefined) => Math.min(1, Math.max(0, v ?? 0.5))
        const id = newId()
        get().dispatch({ type: 'comment.add', comment: { id, frameId: f.id, x: clamp(num(input.x)), y: clamp(num(input.y)), text: text.slice(0, 4000), forAgents: input.for_agents === true } })
        return ok({ comment_id: id })
      },
    },
    {
      name: 'zeko_request_design',
      description: 'Ask the canvas’s design agents for work, as the person would from the request box: describe the change, and name the frames it concerns.',
      inputSchema: object({ text: { type: 'string' }, frame_ids: { type: 'array', items: { type: 'string' } } }, ['text']),
      async execute(input) {
        const s = get()
        const text = str(input.text)?.trim()
        if (!text) return err('Describe the request.')
        const frameIds = Array.isArray(input.frame_ids) ? input.frame_ids.filter((id): id is string => typeof id === 'string' && !!frameById(id)) : []
        const id = newId()
        s.dispatch({ type: 'task.add', id, text: text.slice(0, 8000), frameIds, pageId: s.pageId })
        return ok({ request_id: id })
      },
    },
    {
      name: 'zeko_set_token',
      description: `Add or change a design token for the active theme. Sketches use it as var(--name). Kinds: ${Object.keys(tokenLabels).join(', ')}.`,
      inputSchema: object({ name: { type: 'string' }, kind: { type: 'string', enum: Object.keys(tokenLabels) }, value: { type: 'string' } }, ['name', 'kind', 'value']),
      async execute(input) {
        const s = get()
        const name = str(input.name)?.trim().replace(/^--/, '').toLowerCase()
        const kind = str(input.kind) as TokenKind | undefined
        const value = str(input.value)?.trim()
        if (!name || !value || !kind || !Object.hasOwn(tokenLabels, kind)) return err('Pass a token name, kind and CSS value.')
        s.dispatch({ type: 'design.token.set', name, kind, themeId: s.board.design?.themeId ?? 'default', value })
        return ok(`Set --${name}.`)
      },
    },
    {
      name: 'zeko_get_frame_code',
      description: 'A sketch as code for implementation: its HTML or a React component, with the canvas tokens defined.',
      inputSchema: object({ frame_id: { type: 'string' }, format: { type: 'string', enum: ['html', 'react'] } }, ['frame_id']),
      annotations: { readOnlyHint: true },
      async execute(input) {
        const f = frameById(input.frame_id)
        if (!f || f.kind !== 'sketch' || f.html === undefined) return err(`No sketch ${String(input.frame_id)}.`)
        return ok(frameCode(f.html, f.name, get().board.design, input.format === 'html' ? 'html' : 'react'))
      },
    },
  ]
}

/** Offers the canvas's tools to in-browser agents for as long as the studio is open. */
export function useWebMcp(state: StudioState | null) {
  const latest = useRef(state)
  useEffect(() => {
    latest.current = state
  })
  const ready = !!state
  useEffect(() => {
    if (!ready) return
    const context = (navigator as Navigator & { modelContext?: ModelContext }).modelContext
    if (!context) return
    const list = tools(() => latest.current!)
    if (context.provideContext) {
      context.provideContext({ tools: list })
      return () => context.clearContext?.()
    }
    if (!context.registerTool) return
    const handles = list.map((tool) => {
      try {
        return context.registerTool!(tool)
      } catch {
        return undefined
      }
    })
    return () => {
      handles.forEach((handle, i) => {
        if (handle && typeof handle === 'object' && handle.unregister) handle.unregister()
        else context.unregisterTool?.(list[i]!.name)
      })
    }
  }, [ready])
}
