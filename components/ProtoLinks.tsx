'use client'

import { useState } from 'react'
import { deckFront, framePage, pageStart, visibleFrames } from '@/lib/ops'
import type { Board, Frame } from '@/lib/types'
import { useStudio } from './studio-context'

export const LINK = '#5b6cff'

/** The frame a link points at as the board shows it: a variant's deck shows its chosen one. */
export function linkTarget(board: Board, id: string): Frame | undefined {
  const f = board.frames.find((x) => x.id === id)
  return f?.deckId ? (deckFront(board, f.deckId) ?? f) : f
}

/**
 * Prototype mode on the board, in world space: every link's arrow from its
 * element to the screen it opens, a flag on the start screen, and on the
 * picked element a handle to drag onto another screen to link it.
 */
export function ProtoLinks() {
  const { board, pageId, camera, hotspots, interactId, element, toFrame, stageRef } = useStudio()
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const k = 1 / camera.z
  const frames = visibleFrames(board, pageId).filter((f) => f.kind === 'sketch' && !f.shape)
  const startId = pageStart(board, pageId)
  const start = startId ? linkTarget(board, startId) : undefined

  const links: { key: string; d: string; spot: { x: number; y: number; w: number; h: number }; back: boolean }[] = []
  for (const f of frames) {
    for (const h of hotspots[f.id] ?? []) {
      const spot = { x: f.x + h.x, y: f.y + h.y, w: h.w, h: h.h }
      if (h.to === 'back') {
        links.push({ key: `${f.id}:${h.path}`, d: '', spot, back: true })
        continue
      }
      const t = linkTarget(board, h.to)
      if (!t || t.id === f.id || framePage(board, t) !== pageId) continue
      links.push({ key: `${f.id}:${h.path}`, d: curve(f, spot, t), spot, back: false })
    }
  }

  const picked = interactId ? board.frames.find((f) => f.id === interactId) : undefined
  const handle = picked && element ? { x: picked.x + element.rect.x + element.rect.w, y: picked.y + element.rect.y + element.rect.h / 2 } : null

  const worldOf = (e: React.PointerEvent) => {
    const r = stageRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left - camera.x) / camera.z, y: (e.clientY - r.top - camera.y) / camera.z }
  }
  const dropOn = (p: { x: number; y: number }) => [...frames].reverse().find((f) => f.id !== picked?.id && p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h)
  const over = drag ? dropOn(drag) : undefined

  return (
    <>
      <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1}>
        <defs>
          <marker id="zeko-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={LINK} />
          </marker>
        </defs>
        {links.map((l) => (
          <g key={l.key}>
            <rect x={l.spot.x} y={l.spot.y} width={l.spot.w} height={l.spot.h} rx={4 * k} fill={`${LINK}22`} stroke={LINK} strokeWidth={1.5 * k} />
            {l.d && <path d={l.d} fill="none" stroke={LINK} strokeWidth={2 * k} markerEnd="url(#zeko-arrow)" />}
          </g>
        ))}
        {handle && drag && <path d={`M ${handle.x} ${handle.y} L ${drag.x} ${drag.y}`} stroke={LINK} strokeWidth={2 * k} strokeDasharray={`${6 * k} ${4 * k}`} markerEnd="url(#zeko-arrow)" />}
        {over && <rect x={over.x} y={over.y} width={over.w} height={over.h} fill="none" stroke={LINK} strokeWidth={3 * k} />}
      </svg>

      {links
        .filter((l) => l.back)
        .map((l) => (
          <span
            key={`${l.key}:back`}
            className="pointer-events-none absolute rounded-full font-medium whitespace-nowrap text-white"
            style={{ left: l.spot.x + l.spot.w + 6 * k, top: l.spot.y + l.spot.h / 2, transform: `translateY(-50%) scale(${k})`, transformOrigin: '0 50%', background: LINK, fontSize: 11, padding: '2px 8px' }}
          >
            ← Back
          </span>
        ))}

      {start && (
        <span
          className="pointer-events-none absolute flex items-center gap-1 rounded-full font-medium whitespace-nowrap text-white"
          style={{ left: start.x - 10 * k, top: start.y, transform: `translate(-100%, 0) scale(${k})`, transformOrigin: '100% 0', background: LINK, fontSize: 12, padding: '3px 10px' }}
        >
          ▶ Start
        </span>
      )}

      {handle && (
        <span
          role="button"
          aria-label="Drag onto a screen to link"
          title="Drag onto a screen to link"
          className="absolute grid place-items-center rounded-full border-2 border-white shadow"
          style={{ left: handle.x, top: handle.y, width: 16 * k, height: 16 * k, transform: 'translate(-50%, -50%)', background: LINK, cursor: 'grab' }}
          onPointerDown={(e) => {
            e.stopPropagation()
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            setDrag(worldOf(e))
          }}
          onPointerMove={(e) => drag && setDrag(worldOf(e))}
          onPointerUp={(e) => {
            const target = drag ? dropOn(worldOf(e)) : undefined
            setDrag(null)
            if (target && element) toFrame({ type: 'apply', path: element.path, attrs: { 'data-zeko-goto': target.id } })
          }}
        />
      )}
    </>
  )
}

/** An arrow from the element's nearer side to the target screen's facing edge. */
function curve(from: Frame, spot: { x: number; y: number; w: number; h: number }, to: Frame) {
  const right = to.x + to.w / 2 >= from.x + from.w / 2
  const clampY = (y: number, f: Frame) => Math.min(f.y + f.h, Math.max(f.y, y))
  const sx = right ? Math.min(from.x + from.w, spot.x + spot.w) : Math.max(from.x, spot.x)
  const sy = clampY(spot.y + spot.h / 2, from)
  const tx = right ? to.x : to.x + to.w
  const ty = to.y + Math.min(to.h / 2, 80)
  const bend = Math.max(80, Math.abs(tx - sx) / 2) * (right ? 1 : -1)
  return `M ${sx} ${sy} C ${sx + bend} ${sy} ${tx - bend} ${ty} ${tx} ${ty}`
}
