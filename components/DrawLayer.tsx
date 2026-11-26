'use client'

import { useEffect, useRef, useState } from 'react'
import { visibleFrames } from '@/lib/ops'
import { newId } from '@/lib/client/useBoard'
import {
  dragBox,
  editTextShape,
  insertShape,
  INK_CANVAS,
  INK_PAGE,
  measureText,
  pathBounds,
  pathData,
  readTextShape,
  SHAPE_NAMES,
  shapeDocument,
  snap45,
  TEXT_FONT,
  type Anchor,
  type Box,
  type Point,
} from '@/lib/client/draw'
import type { Frame, ShapeKind } from '@/lib/types'
import { useCameraSnapshot, useStudio } from './studio-context'

const BLANK_FRAME = '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#fff"></body></html>'
const CLICK = 4 // screen pixels a press can wander and still count as a click

/** a, b: the drag in world space. sa, sb: on screen, relative to the stage. */
type BoxDraft = { tool: 'frame' | 'rect' | 'ellipse' | 'zoom'; a: Point; b: Point; sa: Point; sb: Point; square: boolean }
type PenDraft = { anchors: Anchor[]; cursor: Point | null; dragging: boolean }
type TextDraft = { at: Point; frameId: string | null; existing?: NonNullable<ReturnType<typeof readTextShape>> & { w: number; h: number } }

/**
 * Over the board while a drawing tool is picked, or while Z is held for zoom.
 * Shapes drawn on bare canvas become frames of their own; drawn over a sketch,
 * they go into its page where they were drawn.
 */
export function DrawLayer({ zoomHeld, zoomOut }: { zoomHeld: boolean; zoomOut: boolean }) {
  const { board, pageId, setCamera, tool, setTool, dispatch, select, stageRef, playerOpen } = useStudio()
  const camera = useCameraSnapshot()
  const [box, setBox] = useState<BoxDraft | null>(null)
  const [pen, setPen] = useState<PenDraft | null>(null)
  const [text, setText] = useState<TextDraft | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const world = (e: { clientX: number; clientY: number }): Point => {
    const r = stageRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left - camera.x) / camera.z, y: (e.clientY - r.top - camera.y) / camera.z }
  }
  const onStage = (e: { clientX: number; clientY: number }): Point => {
    const r = stageRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const toScreen = (p: Point) => ({ x: p.x * camera.z + camera.x, y: p.y * camera.z + camera.y })

  /** The sketch under a point, top-most first. Shapes don't take drawings. */
  const sketchAt = (p: Point): Frame | undefined =>
    [...visibleFrames(board, pageId)].reverse().find((f) => f.kind === 'sketch' && !f.shape && p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h)

  const beginText = (at: Point) => {
    const target = [...visibleFrames(board, pageId)].reverse().find((frame) => frame.shape === 'text' && at.x >= frame.x && at.x <= frame.x + frame.w && at.y >= frame.y && at.y <= frame.y + frame.h)
    const existing = target && readTextShape(target.html ?? '')
    if (target && existing) {
      setText({ at: { x: target.x, y: target.y }, frameId: target.id, existing: { ...existing, w: target.w, h: target.h } })
    } else {
      setText({ at, frameId: sketchAt(at)?.id ?? null })
    }
  }

  const place = (kind: ShapeKind, at: Box, opts: { d?: string; text?: string; viewBox?: Box }, anchor: Point) => {
    const target = sketchAt(anchor)
    if (target) {
      const local = { ...at, x: at.x - target.x, y: at.y - target.y }
      dispatch({ type: 'frame.update', id: target.id, patch: { html: insertShape(target.html ?? '', kind, local, opts) } })
      select([target.id])
    } else {
      const id = newId()
      dispatch({ type: 'frame.create', frame: { id, pageId, kind: 'sketch', shape: kind, name: SHAPE_NAMES[kind], html: shapeDocument(kind, opts), ...at } })
      select([id])
    }
    setTool('select')
  }

  const finishPen = (closed = false) => {
    const anchors = pen?.anchors ?? []
    setPen(null)
    if (anchors.length < 2) return
    const b = pathBounds(anchors)
    place('path', b, { d: pathData(anchors, closed, { x: b.x, y: b.y }), viewBox: b }, anchors[0]!)
  }

  const finishText = () => {
    const t = text
    const value = textRef.current?.value ?? ''
    setText(null)
    if (!t || !value.trim()) return
    const size = measureText(value, t.existing?.font)
    if (t.existing) {
      const frame = board.frames.find((item) => item.id === t.frameId)
      if (frame?.shape === 'text') {
        if (value !== t.existing.value) {
          dispatch({ type: 'frame.update', id: frame.id, patch: {
            ...size, html: editTextShape(frame.html ?? '', value),
            ...(frame.sheetRoute !== undefined ? { name: value.trim().slice(0, 120), x: frame.x + frame.w - size.w } : {}),
          } })
        }
        select([frame.id])
      }
      setTool('select')
      return
    }
    place('text', { x: Math.round(t.at.x), y: Math.round(t.at.y), ...size }, { text: value }, t.at)
  }

  // Switching tools mid-path keeps what was drawn so far.
  const finishPenRef = useRef(finishPen)
  useEffect(() => {
    finishPenRef.current = finishPen
  })
  useEffect(() => {
    if (tool !== 'path') finishPenRef.current()
  }, [tool])

  // Enter finishes a path; Escape finishes it too, or drops a lone first point.
  useEffect(() => {
    if (!pen || playerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      finishPenRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pen, playerOpen])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const p = world(e)
    if (zoomHeld) {
      setBox({ tool: 'zoom', a: p, b: p, sa: onStage(e), sb: onStage(e), square: false })
      return
    }
    // A press elsewhere ends the text being typed: blurring it saves it, once.
    if (text) return textRef.current?.blur()
    switch (tool) {
      case 'frame':
      case 'rect':
      case 'ellipse':
        setBox({ tool, a: p, b: p, sa: onStage(e), sb: onStage(e), square: e.shiftKey })
        return
      case 'text':
        e.preventDefault()
        beginText(p)
        return
      case 'path': {
        if (e.detail >= 2) return finishPen()
        const anchors = pen?.anchors ?? []
        const first = anchors[0]
        if (first && anchors.length > 2 && Math.hypot(first.x - p.x, first.y - p.y) * camera.z < 8) return finishPen(true)
        const at = e.shiftKey && anchors.length ? snap45(anchors.at(-1)!, p) : p
        setPen({ anchors: [...anchors, { x: at.x, y: at.y }], cursor: null, dragging: true })
        return
      }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = world(e)
    if (box) return setBox({ ...box, b: p, sb: onStage(e), square: e.shiftKey })
    if (!pen) return
    if (pen.dragging) {
      const last = pen.anchors.at(-1)!
      if (Math.hypot(p.x - last.x, p.y - last.y) * camera.z < 3) return
      setPen({ ...pen, anchors: [...pen.anchors.slice(0, -1), { ...last, hx: p.x, hy: p.y }] })
    } else {
      setPen({ ...pen, cursor: e.shiftKey && pen.anchors.length ? snap45(pen.anchors.at(-1)!, p) : p })
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (pen?.dragging) return setPen({ ...pen, dragging: false })
    const d = box
    setBox(null)
    if (!d) return
    const click = Math.hypot(d.sb.x - d.sa.x, d.sb.y - d.sa.y) < CLICK
    if (d.tool === 'zoom') return zoom(d, click, e.altKey || zoomOut)
    const drawn = dragBox(d.a, d.b, d.square)
    if (d.tool === 'frame') {
      const at = click ? { x: Math.round(d.a.x), y: Math.round(d.a.y), w: 1280, h: 800 } : { ...drawn, w: Math.max(40, drawn.w), h: Math.max(40, drawn.h) }
      const id = newId()
      const n = visibleFrames(board, pageId).filter((f) => !f.shape).length + 1
      dispatch({ type: 'frame.create', frame: { id, pageId, kind: 'sketch', name: `Frame ${n}`, html: BLANK_FRAME, ...at } })
      select([id])
      setTool('select')
      return
    }
    const at = click ? { x: Math.round(d.a.x), y: Math.round(d.a.y), w: 100, h: 100 } : { ...drawn, w: Math.max(2, drawn.w), h: Math.max(2, drawn.h) }
    place(d.tool, at, {}, d.a)
  }

  const zoom = (d: BoxDraft, click: boolean, out: boolean) => {
    const r = stageRef.current!.getBoundingClientRect()
    if (click) {
      const px = d.sa.x
      const py = d.sa.y
      setCamera((c) => {
        const z = Math.min(4, Math.max(0.05, c.z * (out ? 0.5 : 2)))
        return { z, x: px - ((px - c.x) / c.z) * z, y: py - ((py - c.y) / c.z) * z }
      })
      return
    }
    const b = dragBox(d.a, d.b, false)
    const z = Math.min(4, Math.max(0.05, Math.min(r.width / b.w, r.height / b.h) * 0.9))
    setCamera({ z, x: r.width / 2 - (b.x + b.w / 2) * z, y: r.height / 2 - (b.y + b.h / 2) * z })
  }

  const cursor = zoomHeld ? (zoomOut ? 'zoom-out' : 'zoom-in') : tool === 'text' ? 'text' : 'crosshair'
  const preview = box && box.tool !== 'zoom' ? dragBox(box.a, box.b, box.square) : null
  const zoomBox = box?.tool === 'zoom' ? dragBox(box.sa, box.sb, false) : null

  return (
    <div className="absolute inset-0" style={{ cursor }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setBox(null)}>
      {preview && (
        <div
          className="pointer-events-none absolute border-[#5b6cff]"
          style={{
            left: preview.x * camera.z + camera.x,
            top: preview.y * camera.z + camera.y,
            width: preview.w * camera.z,
            height: preview.h * camera.z,
            borderWidth: 1.5,
            borderRadius: box!.tool === 'ellipse' ? '50%' : 0,
            background: box!.tool === 'frame' ? 'rgb(255 255 255 / 0.9)' : 'rgb(212 213 218 / 0.85)',
          }}
        >
          <span className="absolute top-full left-1/2 mt-1.5 -translate-x-1/2 rounded bg-[#5b6cff] px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-white tabular-nums">
            {preview.w} × {preview.h}
          </span>
        </div>
      )}
      {zoomBox && (
        <div
          className="pointer-events-none absolute border border-dashed border-ink/60 bg-white/[0.04]"
          style={{ left: zoomBox.x, top: zoomBox.y, width: zoomBox.w, height: zoomBox.h }}
        />
      )}
      {pen && <PenPreview pen={pen} toScreen={toScreen} />}
      {text && (
        <textarea
          ref={textRef}
          autoFocus
          aria-label="Text"
          rows={1}
          defaultValue={text.existing?.value}
          onFocus={(event) => { if (text.existing) event.currentTarget.select() }}
          onBlur={finishText}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
              e.preventDefault()
              if (e.key === 'Escape' && text.existing) {
                setText(null)
                setTool('select')
              } else finishText()
            }
          }}
          className="field-sizing-content absolute min-w-4 resize-none overflow-hidden border-0 bg-transparent p-0 whitespace-pre outline outline-1 outline-[#5b6cff]"
          style={{
            left: text.existing?.rightAligned ? undefined : toScreen(text.at).x,
            right: text.existing?.rightAligned ? `calc(100% - ${toScreen({ x: text.at.x + text.existing.w, y: text.at.y }).x}px)` : undefined,
            top: toScreen(text.at).y,
            font: text.existing?.font ?? TEXT_FONT,
            color: text.existing?.ink ?? (text.frameId ? INK_PAGE : INK_CANVAS),
            backgroundColor: text.existing ? 'var(--color-table)' : undefined,
            minWidth: text.existing?.w,
            minHeight: text.existing?.h,
            textAlign: text.existing?.rightAligned ? 'right' : undefined,
            transform: `scale(${camera.z})`,
            transformOrigin: text.existing?.rightAligned ? '100% 0' : '0 0',
          }}
        />
      )}
    </div>
  )
}

function PenPreview({ pen, toScreen }: { pen: PenDraft; toScreen: (p: Point) => Point }) {
  const pts = pen.anchors.map((a) => {
    const s = toScreen(a)
    const h = a.hx !== undefined ? toScreen({ x: a.hx, y: a.hy! }) : undefined
    return { x: s.x, y: s.y, hx: h?.x, hy: h?.y }
  })
  const last = pts.at(-1)
  const cursor = pen.cursor && !pen.dragging ? toScreen(pen.cursor) : null
  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
      <path d={pathData(pts, false)} fill="none" stroke="#5b6cff" strokeWidth={1.5} />
      {cursor && last && <line x1={last.x} y1={last.y} x2={cursor.x} y2={cursor.y} stroke="#5b6cff" strokeWidth={1} strokeDasharray="4 3" />}
      {pts.map((p, i) => (
        <g key={i}>
          {p.hx !== undefined && (
            <>
              <line x1={2 * p.x - p.hx} y1={2 * p.y - p.hy!} x2={p.hx} y2={p.hy} stroke="#5b6cff" strokeWidth={1} />
              <circle cx={p.hx} cy={p.hy} r={3} fill="#fff" stroke="#5b6cff" />
              <circle cx={2 * p.x - p.hx} cy={2 * p.y - p.hy!} r={3} fill="#fff" stroke="#5b6cff" />
            </>
          )}
          <rect x={p.x - 4} y={p.y - 4} width={8} height={8} fill={i === 0 ? '#5b6cff' : '#fff'} stroke="#5b6cff" strokeWidth={1.5} />
        </g>
      ))}
    </svg>
  )
}
