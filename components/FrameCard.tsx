'use client'

import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { tokenCss, withTokenCss } from '@/lib/tokens'
import { alignMovingBox, boxAround, type FrameBox } from '@/lib/client/frame-snap'
import { Braces, Camera, Check, ChevronLeft, Code2, Download, FileCode, Globe, Link2, PenLine, PencilRuler, ChevronRight, Columns2, Copy, ExternalLink, GitBranch, Layers, MousePointerClick, Scan, Trash2 } from 'lucide-react'
import { deckMembers, frameSourceUrl, visibleFrames } from '@/lib/ops'
import { agentColor } from '@/lib/client/useBoard'
import type { Frame } from '@/lib/types'
import { LIVE_FRAMES } from '@/lib/features'
import { STREAM_MARKER, cameFromBridge, registerFrame, sendToFrame, withBridge } from '@/lib/client/bridge'
import { useFrameActions } from './actions'
import { FrameComments } from './FrameComments'
import { DriftBadge, DriftPins } from './BuildSections'
import { useCameraZoom, useStudio } from './studio-context'
import { cx, type MenuItem } from './kit'

type Corner = 'nw' | 'ne' | 'sw' | 'se'
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']
const MIN_W = 160
const MIN_H = 120

interface Gesture {
  kind: 'move' | 'resize'
  corner?: Corner
  sx: number
  sy: number
  start: Record<string, { x: number; y: number; w: number; h: number }>
  moved: boolean
  inspect?: boolean
  alignment?: { bounds: FrameBox; neighbors: FrameBox[] }
  last?: Record<string, { x?: number; y?: number; w?: number; h?: number }>
}

export function FrameCard({ frame, panLocked, workers }: { frame: Frame; panLocked: boolean; workers?: ReadonlySet<string> }) {
  const s = useStudio()
  const { board, frameGesture, selection, tool, interactId } = s
  const zoom = useCameraZoom()
  const gesture = useRef<Gesture | null>(null)
  const previewing = useRef(false)
  const act = useFrameActions()
  const [hovered, setHovered] = useState(false)

  const getOverride = () => frameGesture.getOverride(frame.id)
  const o = useSyncExternalStore(frameGesture.subscribe, getOverride, getOverride) ?? {}
  const box = { x: o.x ?? frame.x, y: o.y ?? frame.y, w: o.w ?? frame.w, h: o.h ?? frame.h }
  const selected = selection.includes(frame.id)
  const interacting = interactId === frame.id
  const members = frame.deckId ? deckMembers(board, frame.deckId) : []
  const position = members.findIndex((m) => m.id === frame.id)
  const k = 1 / zoom
  const labelWidth = box.w / k
  const columns = Math.min(16, Math.max(2, Math.floor(labelWidth / 21)))
  const activityWidth = workers?.size ? columns * 9 + 4 : 0
  const canInspect = tool === 'select' && !panLocked && !interacting && !s.prototype && !s.playerOpen && frame.kind === 'sketch' && !frame.shape
  const canInteract = frame.kind !== 'live' || LIVE_FRAMES

  useEffect(() => {
    if (!canInspect && previewing.current) {
      previewing.current = false
      sendToFrame(frame.id, { type: 'hover-point', point: null })
    }
  }, [canInspect, frame.id])
  useEffect(() => {
    if (interacting && frame.kind === 'sketch') sendToFrame(frame.id, { type: 'zoom', zoom })
  }, [interacting, frame.kind, frame.id, zoom])

  const pointInFrame = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom }
  }

  const clearPreview = () => {
    if (!previewing.current) return
    previewing.current = false
    sendToFrame(frame.id, { type: 'hover-point', point: null })
  }

  const preview = (e: React.PointerEvent) => {
    if (!canInspect || e.buttons || e.pointerType === 'touch') return
    previewing.current = true
    sendToFrame(frame.id, { type: 'hover-point', point: pointInFrame(e), zoom })
  }

  const beginMove = (e: React.PointerEvent) => {
    clearPreview()
    if (panLocked || e.button !== 0) return
    e.stopPropagation()
    // Prototype mode: a click on a screen opens it to pick the element to link.
    if (s.prototype && frame.kind === 'sketch' && !frame.shape && !e.shiftKey) {
      s.select([frame.id])
      act.use(frame)
      return
    }
    if (tool === 'comment') {
      // Keep the browser from moving focus to the page after the composer focuses itself.
      e.preventDefault()
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
      s.setOpenThread(null)
      s.setDraft({ frameId: frame.id, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height })
      return
    }
    let ids = selection
    if (e.shiftKey) {
      s.toggle(frame.id)
      if (selected) return
      ids = [...selection, frame.id]
    } else if (!selected) {
      ids = [frame.id]
      s.select(ids)
    }
    const start: Gesture['start'] = {}
    for (const id of ids) {
      const f = board.frames.find((x) => x.id === id)
      if (f) start[id] = { x: f.x, y: f.y, w: f.w, h: f.h }
    }
    const moving = Object.values(start)
    gesture.current = {
      kind: 'move', sx: e.clientX, sy: e.clientY, start, moved: false,
      inspect: canInspect && selected && selection.length === 1 && !e.shiftKey && !e.metaKey && !e.ctrlKey,
      alignment: moving.length ? {
        bounds: boxAround(moving),
        neighbors: visibleFrames(board, s.pageId).filter((other) => !Object.hasOwn(start, other.id)),
      } : undefined,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const beginResize = (corner: Corner) => (e: React.PointerEvent) => {
    clearPreview()
    e.stopPropagation()
    gesture.current = { kind: 'resize', corner, sx: e.clientX, sy: e.clientY, start: { [frame.id]: { ...box } }, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g) return
    const dx = (e.clientX - g.sx) / zoom
    const dy = (e.clientY - g.sy) / zoom
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 3) return
    g.moved = true
    const next: Record<string, { x?: number; y?: number; w?: number; h?: number }> = {}
    if (g.kind === 'move') {
      const x = Math.round(dx)
      const y = Math.round(dy)
      const alignment = g.alignment && !e.altKey
        ? alignMovingBox({ ...g.alignment.bounds, x: g.alignment.bounds.x + x, y: g.alignment.bounds.y + y }, g.alignment.neighbors, zoom)
        : undefined
      for (const [id, b] of Object.entries(g.start)) {
        next[id] = { x: b.x + x + (alignment?.dx ?? 0), y: b.y + y + (alignment?.dy ?? 0) }
      }
      g.last = next
      frameGesture.set(next, alignment?.guides)
    } else {
      const b = g.start[frame.id]!
      const west = g.corner === 'nw' || g.corner === 'sw'
      const north = g.corner === 'nw' || g.corner === 'ne'
      const w = Math.max(frame.shape ? 2 : MIN_W, Math.round(west ? b.w - dx : b.w + dx))
      const h = Math.max(frame.shape ? 2 : MIN_H, Math.round(north ? b.h - dy : b.h + dy))
      next[frame.id] = { x: west ? b.x + b.w - w : b.x, y: north ? b.y + b.h - h : b.y, w, h }
      g.last = next
      frameGesture.set(next)
    }
  }

  const onUp = (e: React.PointerEvent) => {
    const g = gesture.current
    gesture.current = null
    if (g?.inspect && !g.moved && e.type === 'pointerup' && canInspect) {
      const point = pointInFrame(e)
      act.use(frame)
      sendToFrame(frame.id, { type: 'pick-point', point, parent: e.altKey, zoom })
      e.currentTarget.parentElement?.querySelector('iframe')?.focus()
      return
    }
    if (!g?.moved || !g.last) return
    if (e.type === 'pointerup') {
      s.dispatch({ type: 'batch', ops: Object.entries(g.last).map(([id, patch]) => ({ type: 'frame.update' as const, id, patch })) })
    }
    frameGesture.set({})
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!selected) s.select([frame.id])
    const many = selected && selection.length > 1
    if (many) {
      s.openMenu(e.clientX, e.clientY, [
        ...(selection.length === 2 ? [{ label: 'Compare the two', icon: <Columns2 size={14} />, keys: ['L'], onSelect: () => s.openLoupe() }] : []),
        { label: `Delete ${selection.length} frames`, icon: <Trash2 size={14} />, keys: ['⌫'], danger: true, onSelect: () => act.remove(selection) },
      ])
      return
    }
    const items: (MenuItem | 'divider')[] = []
    if (frame.kind === 'sketch') items.push(
      { label: 'Edit contents', icon: <PencilRuler size={14} />, keys: ['↵'], onSelect: () => act.use(frame) },
      { label: 'Edit HTML', icon: <Braces size={14} />, onSelect: () => s.openCode(frame.id) },
    )
    if (canInteract && frame.kind !== 'sketch') items.push({ label: 'Use the page', icon: <MousePointerClick size={14} />, keys: ['↵'], onSelect: () => act.use(frame) })
    if (frame.kind === 'website') items.push(
      { label: 'Edit website URL', icon: <Link2 size={14} />, onSelect: () => s.openWebsite(frame.id) },
      { label: 'Snapshot as editable sketch', icon: <Camera size={14} />, onSelect: () => void act.snapshot(frame) },
    )
    items.push(
      { label: 'Make a variant', icon: <Layers size={14} />, keys: ['⌘', 'D'], onSelect: () => act.variant(frame) },
      ...(frame.kind !== 'website' && !frame.shape && !frame.buildOf ? [{ label: members.length > 1 ? 'Alternates' : 'Explore alternates', icon: <GitBranch size={14} />, keys: ['B'], onSelect: () => s.openAlternates(frame.id) }] : []),
      { label: 'Duplicate', icon: <Copy size={14} />, onSelect: () => act.duplicate(frame) },
    )
    if (members.length > 1) {
      items.push(
        'divider',
        { label: 'Keep this variant', icon: <Check size={14} />, keys: ['K'], onSelect: () => act.keep(frame) },
        { label: 'Compare with previous', icon: <Columns2 size={14} />, keys: ['L'], onSelect: () => act.compare(frame) },
      )
    }
    items.push('divider', { label: 'Zoom to frame', icon: <Scan size={14} />, keys: ['⇧', '2'], onSelect: () => act.zoomTo(frame) })
    if (frame.kind === 'sketch')
      items.push(
        { label: 'Export PNG 2×', icon: <Download size={14} />, onSelect: () => void act.exportPng(frame, 2) },
        { label: 'Export HTML', icon: <FileCode size={14} />, onSelect: () => act.exportHtml(frame) },
        { label: 'Copy as HTML', icon: <Copy size={14} />, onSelect: () => void act.copyCode(frame, 'html') },
        { label: 'Copy as React', icon: <Code2 size={14} />, onSelect: () => void act.copyCode(frame, 'react') },
      )
    if (canInteract && act.canOpenInTab(frame)) items.push({ label: 'Open in new tab', icon: <ExternalLink size={14} />, onSelect: () => act.openInTab(frame) })
    items.push('divider', { label: 'Delete', icon: <Trash2 size={14} />, keys: ['⌫'], danger: true, onSelect: () => act.remove([frame.id]) })
    s.openMenu(e.clientX, e.clientY, items)
  }

  const single = selected && selection.length === 1 && !interacting
  const ring = selected
    ? `0 0 0 ${1.5 * k}px var(--color-grease)`
    : hovered
      ? `0 0 0 ${1.5 * k}px rgb(255 255 255 / 0.35)`
      : null

  return (
    <div
      className="absolute"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onContextMenu={onContextMenu}
    >
      {members.length > 1 && <DeckFan count={members.length} k={k} />}

      {!frame.shape && <Label frame={frame} members={members} position={position} k={k} selected={selected} interacting={interacting} width={Math.max(0, labelWidth - activityWidth)} />}
      {!!workers?.size && <FrameActivity workers={[...workers]} columns={columns} k={k} />}

      <div
        className={cx('frame-surface absolute inset-0', frame.shape ? 'overflow-visible' : 'overflow-hidden bg-white')}
        style={{
          borderRadius: frame.shape ? 0 : 2 * k,
          boxShadow: frame.shape ? (ring ?? undefined) : ring ? `${ring}, var(--shadow-slide)` : 'var(--shadow-slide)',
        }}
      >
        <DeferredFrameSurface stageRef={s.stageRef} frame={frame} appUrl={board.appUrl} css={tokenCss(board.design)} interactive={interacting}
          eager={selected || (s.prototype && frame.kind === 'sketch' && !frame.shape)} />
        {!interacting && (
          <div
            className="absolute inset-0"
            onPointerDown={beginMove}
            onPointerEnter={preview}
            onPointerMove={(e) => gesture.current ? onMove(e) : preview(e)}
            onPointerLeave={clearPreview}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onLostPointerCapture={onUp}
            onDoubleClick={() => tool === 'select' && canInteract && act.use(frame)}
          />
        )}
      </div>

      <FrameComments frame={frame} />
      <DriftPins frame={frame} />

      {single &&
        CORNERS.map((c) => (
          <div
            key={c}
            role="slider"
            aria-label={`Resize from the ${c} corner`}
            aria-valuenow={box.w}
            tabIndex={-1}
            className="absolute rounded-[2px] border-grease bg-white"
            style={{
              width: 8 * k,
              height: 8 * k,
              borderWidth: 1.5 * k,
              left: c[1] === 'w' ? -4 * k : undefined,
              right: c[1] === 'e' ? -4 * k : undefined,
              top: c[0] === 'n' ? -4 * k : undefined,
              bottom: c[0] === 's' ? -4 * k : undefined,
              cursor: c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize',
            }}
            onPointerDown={beginResize(c)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onLostPointerCapture={onUp}
          />
        ))}
      {single && (
        <div className="pointer-events-none absolute top-full left-1/2 origin-top" style={{ transform: `translateX(-50%) scale(${k})`, marginTop: 8 * k }}>
          <span className="block rounded-[4px] bg-grease px-1.5 py-px text-2xs font-medium whitespace-nowrap text-white tabular-nums">
            {box.w} × {box.h}
          </span>
        </div>
      )}
    </div>
  )
}

/** The slides underneath a deck's top card, fanned so the stack reads at a glance. */
function DeckFan({ count, k }: { count: number; k: number }) {
  const layers = Math.min(count - 1, 3)
  return (
    <>
      {Array.from({ length: layers }, (_, i) => {
        const n = layers - i
        const turn = n % 2 === 0 ? -1.1 * n : 0.9 * n
        return (
          <div
            key={n}
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[#3a3c43]"
            style={{
              borderRadius: 3 * k,
              // Offsets in screen pixels (k undoes the zoom), so the stack reads at every zoom.
              transform: `translate(${n * 7 * k}px, ${n * 6 * k}px) rotate(${turn}deg)`,
              boxShadow: 'var(--shadow-slide)',
              opacity: 1 - n * 0.12,
            }}
          />
        )
      })}
    </>
  )
}

function FrameActivity({ workers, columns, k }: { workers: string[]; columns: number; k: number }) {
  const colors = workers.map(agentColor)
  return (
    <span
      role="status"
      aria-label={`${workers.join(', ')} working on this frame`}
      className="agent-frame-activity pointer-events-none absolute right-0 z-10 grid origin-bottom-right gap-1"
      style={{ bottom: `calc(100% + ${10 * k}px)`, transform: `scale(${k})`, gridTemplateColumns: `repeat(${columns}, 5px)` }}
    >
      {Array.from({ length: columns * 2 }, (_, index) => (
        <span key={index} aria-hidden style={{
          color: colors[index % colors.length],
          animationDelay: `${-((index % columns) * 90 + Math.floor(index / columns) * 270 + (index % 3) * 65)}ms`,
        }} />
      ))}
    </span>
  )
}

interface LabelProps {
  frame: Frame
  members: Frame[]
  position: number
  k: number
  selected: boolean
  interacting: boolean
  width: number
}

function Label({ frame, members, position, k, selected, interacting, width }: LabelProps) {
  const s = useStudio()
  const act = useFrameActions()
  const flip = (step: number) => {
    const next = members[(position + step + members.length) % members.length]
    if (!next || !frame.deckId) return
    s.dispatch({ type: 'deck.front', deckId: frame.deckId, frameId: next.id })
    s.select([next.id])
  }
  const stop = (e: React.PointerEvent) => e.stopPropagation()

  return (
    <div
      className="absolute bottom-full left-0 flex origin-bottom-left items-center gap-1.5 pb-1.5 whitespace-nowrap"
      style={{ transform: `scale(${k})`, maxWidth: width }}
      onPointerDown={stop}
    >
      <button
        onClick={(e) => {
          if (e.shiftKey) return s.toggle(frame.id)
          if (interacting) s.setInteractId(null)
          s.select([frame.id])
        }}
        className={cx('editor-control flex h-6 min-w-0 items-center gap-1.5 px-1 text-xs', selected && 'font-medium')}
      >
        {frame.kind === 'live' ? <span className="size-1.5 shrink-0 rounded-full bg-live" /> : frame.kind === 'website' ? <Globe size={11} className="shrink-0 opacity-70" /> : <PenLine size={11} className="shrink-0 opacity-70" />}
        <span className="truncate">{frame.name}</span>
        {!interacting && frame.state && frame.state !== 'default' && <span className="shrink-0 rounded bg-wash px-1.5 text-2xs leading-4 text-slate">{frame.state}</span>}
      </button>
      {!interacting && <DriftBadge frame={frame} />}

      {members.length > 1 && (
        <span className="flex h-6 shrink-0 items-center rounded-md bg-panel shadow-[0_0_0_1px_var(--color-hair)]">
          <button aria-label="Previous variant" onClick={() => flip(-1)} className="grid h-full w-5 place-items-center rounded-l-md text-slate hover:bg-wash hover:text-ink">
            <ChevronLeft size={13} />
          </button>
          <span className="px-1 text-2xs font-medium text-slate tabular-nums">
            {position + 1}/{members.length}
          </span>
          <button aria-label="Next variant" onClick={() => flip(1)} className="grid h-full w-5 place-items-center rounded-r-md text-slate hover:bg-wash hover:text-ink">
            <ChevronRight size={13} />
          </button>
        </span>
      )}
      {members.length > 1 && selected && (
        <button
          onClick={() => act.keep(frame)}
          className="flex h-6 shrink-0 items-center gap-1 rounded-md bg-grease px-2 text-xs font-medium text-white hover:bg-grease-deep"
        >
          <Check size={12} strokeWidth={2.5} /> Keep
        </button>
      )}
      {interacting && (
        <span className="flex h-5 shrink-0 items-center gap-1 rounded-md bg-grease-soft px-1.5 text-2xs font-medium text-[#ff8ba2]">
          {frame.kind === 'sketch' ? <PencilRuler size={12} strokeWidth={1.75} /> : <MousePointerClick size={12} strokeWidth={1.75} />}
          <span className={frame.w / k < 100 ? 'sr-only' : undefined}>
            {frame.kind === 'sketch' ? 'Editing' : 'Using page'}
          </span>
        </span>
      )}
    </div>
  )
}

const nearViewport = new WeakMap<Element, () => void>()
const surfaceObservers = new WeakMap<Element, IntersectionObserver>()

const DeferredFrameSurface = memo(function DeferredFrameSurface({ stageRef, frame, appUrl, css, interactive, eager }: {
  stageRef: RefObject<HTMLDivElement | null>; frame: Frame; appUrl: string; css: string; interactive: boolean; eager: boolean
}) {
  const container = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(eager || interactive)
  if (!seen && (eager || interactive)) setSeen(true)

  useEffect(() => {
    const node = container.current
    const root = stageRef.current
    if (seen || !node || !root) return
    if (typeof IntersectionObserver === 'undefined') {
      const next = requestAnimationFrame(() => setSeen(true))
      return () => cancelAnimationFrame(next)
    }
    let observer = surfaceObservers.get(root)
    if (!observer) {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) nearViewport.get(entry.target)?.()
        }
      }, { root, rootMargin: '320px' })
      surfaceObservers.set(root, observer)
    }
    nearViewport.set(node, () => setSeen(true))
    observer.observe(node)
    return () => {
      observer.unobserve(node)
      nearViewport.delete(node)
    }
  }, [seen, stageRef])

  // After the first visit, keep the document mounted so panning preserves its state.
  return (
    <div ref={container} className="absolute inset-0">
      {seen && <FrameSurface frame={frame} appUrl={appUrl} css={css} bridge interactive={interactive} />}
    </div>
  )
})

/** What a frame shows: the running app, or a sketch document. */
export const FrameSurface = memo(function FrameSurface({ frame, appUrl, css, bridge = false, interactive = false }: {
  frame: Frame; appUrl: string; css: string; bridge?: boolean; interactive?: boolean
}) {
  if (frame.kind === 'sketch') return <SketchSurface key={frame.id} frame={frame} css={css} bridge={bridge} interactive={interactive} />
  const src = frameSourceUrl(frame, appUrl)
  if (!src) {
    return (
      <div className="grid size-full place-items-center bg-lightbox p-8 text-center text-slate" style={{ fontSize: Math.max(14, frame.w / 60) }}>
        {frame.kind === 'website' ? 'Set the website URL in Design to load this page.' : 'Set your app’s address in the top bar to show this frame.'}
      </div>
    )
  }
  if (frame.kind === 'website') return (
    <iframe
      title={frame.name}
      src={src}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      tabIndex={interactive ? 0 : -1}
      className="absolute inset-0 size-full border-0 bg-white"
    />
  )
  return (
    <iframe
      title={frame.name}
      src={src}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      className="absolute inset-0 size-full border-0 bg-white"
    />
  )
})

function appendedSections(original: string, html: string) {
  const at = original.indexOf(STREAM_MARKER)
  if (at < 0 || at !== original.lastIndexOf(STREAM_MARKER)) return null
  const suffix = original.slice(at)
  if (!html.startsWith(original.slice(0, at)) || !html.endsWith(suffix) || html.length <= original.length) return null
  return html.slice(at, html.length - suffix.length)
}

/** Keep the same iframe when a sketch gains streamed sections or is edited in place. */
function SketchSurface({ frame, css, bridge, interactive }: { frame: Frame; css: string; bridge: boolean; interactive: boolean }) {
  const html = frame.html ?? ''
  const ref = useRef<HTMLIFrameElement>(null)
  const [preview, setPreview] = useState(() => ({ seen: html, source: html as string | null, doc: withTokenCss(withBridge(html), css), sections: '' }))
  if (bridge && preview.seen !== html) {
    if (cameFromBridge(frame.id, html)) {
      setPreview({ ...preview, seen: html, source: null, sections: '' })
    } else {
      const sections = preview.source !== null && !interactive ? appendedSections(preview.source, html) : null
      if (sections && sections.startsWith(preview.sections)) {
        setPreview({ ...preview, seen: html, sections })
      } else {
        setPreview({ seen: html, source: html, doc: withTokenCss(withBridge(html), css), sections: '' })
      }
    }
  }
  useLayoutEffect(() => {
    if (!bridge) return
    registerFrame(frame.id, ref.current?.contentWindow ?? null)
    return () => registerFrame(frame.id, null)
  }, [bridge, frame.id])
  useEffect(() => {
    if (bridge) ref.current?.contentWindow?.postMessage({ __zeko: 2, type: 'theme', css }, '*')
  }, [bridge, css])
  useEffect(() => {
    const sections = preview.sections
    if (!bridge || !sections) return
    const windowForFrame = ref.current?.contentWindow
    const receive = (event: MessageEvent) => {
      if (event.source !== windowForFrame || event.data?.__zeko !== 1) return
      if (event.data.type === 'ready') windowForFrame?.postMessage({ __zeko: 2, type: 'stream', sections }, '*')
      if (event.data.type === 'stream-fallback' && event.data.sections === sections) {
        setPreview({ seen: html, source: html, doc: withTokenCss(withBridge(html), css), sections: '' })
      }
    }
    window.addEventListener('message', receive)
    windowForFrame?.postMessage({ __zeko: 2, type: 'stream', sections }, '*')
    return () => window.removeEventListener('message', receive)
  }, [bridge, css, html, preview.sections])
  return <iframe
    ref={ref}
    title={frame.name}
    tabIndex={interactive ? 0 : -1}
    srcDoc={bridge ? preview.doc : withTokenCss(html, css)}
    onLoad={() => {
      if (!bridge) return
      ref.current?.contentWindow?.postMessage({ __zeko: 2, type: 'theme', css }, '*')
      if (preview.sections) ref.current?.contentWindow?.postMessage({ __zeko: 2, type: 'stream', sections: preview.sections }, '*')
    }}
    sandbox="allow-scripts allow-forms"
    className={cx('absolute inset-0 size-full border-0', !frame.shape && 'bg-white')}
  />
}
