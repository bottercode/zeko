'use client'

import { useEffect, useRef, useState } from 'react'
import { Circle, Frame as FrameIcon, Globe, Hand, LayoutGrid, Maximize, MessageCircle, Minus, MousePointer2, PanelLeftOpen, PenLine, PenTool, PencilRuler, Plus, Radio, Route, Square, SquareDashedMousePointer, Type } from 'lucide-react'
import { AGENT_AWAY_MS, deckFront, visibleFrames } from '@/lib/ops'
import { FrameCard } from './FrameCard'
import { LIVE_FRAMES } from '@/lib/features'
import { CHROME, isDrawTool, useStudio, type Tool } from './studio-context'
import { Button, IconButton, Tip } from './kit'
import { Separator } from './ui/separator'
import { DrawLayer } from './DrawLayer'
import { ProtoLinks } from './ProtoLinks'

const MIN_ZOOM = 0.05
const MAX_ZOOM = 4

export function Canvas({ leftInset, rightInset, railLeft, onShowLayers }: { leftInset: number; rightInset: number; railLeft: number; onShowLayers?: () => void }) {
  const { board, pageId, camera, now, setCamera, stageRef, tool, select, selection, setDraft, setOpenThread, setInteractId, openMenu, addFrame, openWebsite, dispatch, fit, toast, prototype, playerOpen } = useStudio()
  const [spaceDown, setSpaceDown] = useState(false)
  // Holding Z zooms: click in, Alt-click out, or drag a box to zoom onto.
  const [zoomHeld, setZoomHeld] = useState(false)
  const [altDown, setAltDown] = useState(false)
  const [panning, setPanning] = useState(false)
  const pan = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null)
  const marquee = useRef<{ sx: number; sy: number; base: string[] } | null>(null)
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  // Wheel pans; pinch or ⌘/Ctrl + wheel zooms about the pointer.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        const px = e.clientX - rect.left
        const py = e.clientY - rect.top
        setCamera((c) => {
          const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.z * Math.exp(-e.deltaY * 0.0075)))
          return { z, x: px - ((px - c.x) / c.z) * z, y: py - ((py - c.y) / c.z) * z }
        })
      } else {
        setCamera((c) => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [stageRef, setCamera])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (playerOpen) return
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
      if (e.code === 'Space' && !typing) {
        e.preventDefault()
        setSpaceDown(true)
      }
      if (e.code === 'KeyZ' && !typing && !e.metaKey && !e.ctrlKey) setZoomHeld(true)
      if (e.key === 'Alt') setAltDown(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false)
      if (e.code === 'KeyZ') setZoomHeld(false)
      if (e.key === 'Alt') setAltDown(false)
    }
    const blur = () => {
      setZoomHeld(false)
      setAltDown(false)
    }
    window.addEventListener('blur', blur)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [playerOpen])

  const handMode = tool === 'hand' || spaceDown

  const onPointerDown = (e: React.PointerEvent) => {
    const onBackground = e.target === e.currentTarget || (e.target as HTMLElement).dataset.world !== undefined
    if (!handMode && e.button !== 1 && !onBackground) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (handMode || e.button === 1) {
      pan.current = { sx: e.clientX, sy: e.clientY, cx: camera.x, cy: camera.y }
      setPanning(true)
      return
    }
    if (e.button !== 0) return
    // Dragging on empty canvas draws a selection box; a plain click clears the selection.
    setDraft(null)
    setOpenThread(null)
    setInteractId(null)
    marquee.current = { sx: e.clientX, sy: e.clientY, base: e.shiftKey ? selection : [] }
    if (!e.shiftKey) select([])
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pan.current
    if (p) return setCamera((c) => ({ ...c, x: p.cx + e.clientX - p.sx, y: p.cy + e.clientY - p.sy }))
    const m = marquee.current
    if (!m || Math.hypot(e.clientX - m.sx, e.clientY - m.sy) < 4) return
    const r = stageRef.current!.getBoundingClientRect()
    const screen = {
      x: Math.min(m.sx, e.clientX) - r.left,
      y: Math.min(m.sy, e.clientY) - r.top,
      w: Math.abs(e.clientX - m.sx),
      h: Math.abs(e.clientY - m.sy),
    }
    setBox(screen)
    const wx = (screen.x - camera.x) / camera.z
    const wy = (screen.y - camera.y) / camera.z
    const ww = screen.w / camera.z
    const wh = screen.h / camera.z
    const hit = visibleFrames(board, pageId)
      .filter((f) => f.x < wx + ww && f.x + f.w > wx && f.y < wy + wh && f.y + f.h > wy)
      .map((f) => f.id)
    select([...new Set([...m.base, ...hit])])
  }
  const endPointer = () => {
    pan.current = null
    marquee.current = null
    setPanning(false)
    setBox(null)
  }

  const onContextMenu = (e: React.MouseEvent) => {
    const onBackground = e.target === e.currentTarget || (e.target as HTMLElement).dataset.world !== undefined
    if (!onBackground) return
    e.preventDefault()
    openMenu(e.clientX, e.clientY, [
      ...(LIVE_FRAMES ? [{ label: 'Add live frame', icon: <Radio size={14} />, keys: ['A'], onSelect: () => addFrame('live') }] : []),
      { label: 'Add sketch', icon: <PenLine size={14} />, keys: ['S'], onSelect: () => addFrame('sketch') },
      { label: 'Add website', icon: <Globe size={14} />, onSelect: () => openWebsite() },
      'divider',
      {
        label: 'Arrange as sheet',
        icon: <LayoutGrid size={14} />,
        onSelect: () => {
          dispatch({ type: 'sheet.arrange', pageId })
          toast('Arranged: one row per route')
        },
      },
      { label: 'Fit everything', icon: <Maximize size={14} />, keys: ['⇧', '1'], onSelect: fit },
      { label: 'Select all', icon: <SquareDashedMousePointer size={14} />, keys: ['⌘', 'A'], onSelect: () => select(visibleFrames(board, pageId).map((f) => f.id)) },
    ])
  }

  const frames = visibleFrames(board, pageId)
  const workersByFrame = new Map<string, Set<string>>()
  const markWorking = (name: string, frameId?: string) => {
    if (!frameId) return
    const frame = board.frames.find((item) => item.id === frameId)
    if (!frame) return
    const visibleId = (frame.deckId ? deckFront(board, frame.deckId)?.id : undefined) ?? frame.id
    const workers = workersByFrame.get(visibleId) ?? new Set<string>()
    workers.add(name)
    workersByFrame.set(visibleId, workers)
  }
  for (const agent of Object.values(board.agents)) {
    if (agent.working && (!now || now - agent.lastSeen < AGENT_AWAY_MS)) markWorking(agent.name, agent.frameId)
  }
  for (const task of board.tasks) {
    if (!task.assignee || !task.localRun || task.localRun.error || task.status === 'done') continue
    const agent = board.agents[task.assignee]
    const frameId = agent && agent.lastSeen >= task.updatedAt ? agent.frameId : undefined
    markWorking(task.assignee, frameId ?? task.frameIds[0])
  }
  // Grid spacing on screen stays between 12 and 48px, so the dots read at every zoom.
  let dot = 24 * camera.z
  while (dot < 12) dot *= 4

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        ref={stageRef}
        className="absolute inset-0 select-none"
        style={{
          cursor: handMode ? (panning ? 'grabbing' : 'grab') : tool === 'comment' ? 'crosshair' : 'default',
          backgroundImage: 'radial-gradient(circle, rgb(255 255 255 / 0.08) 1px, transparent 1.2px)',
          backgroundSize: `${dot}px ${dot}px`,
          backgroundPosition: `${camera.x}px ${camera.y}px`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onContextMenu={onContextMenu}
      >
        <div
          data-world=""
          className="absolute top-0 left-0 origin-top-left"
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})` }}
        >
          {frames.map((f) => (
            <FrameCard key={f.deckId ?? f.id} frame={f} panLocked={handMode} workers={workersByFrame.get(f.id)} />
          ))}
          {prototype && <ProtoLinks />}
        </div>
        {box && (
          <div
            className="pointer-events-none absolute rounded-[2px] border border-grease/80 bg-grease/[0.07]"
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
          />
        )}
      </div>

      {!handMode && (isDrawTool(tool) || zoomHeld) && <DrawLayer zoomHeld={zoomHeld} zoomOut={altDown} />}
      {frames.length === 0 && !isDrawTool(tool) && <EmptyTable leftInset={leftInset} rightInset={rightInset} />}
      <Tools left={railLeft} onShowLayers={onShowLayers} />
    </div>
  )
}

function EmptyTable({ leftInset, rightInset }: { leftInset: number; rightInset: number }) {
  const { addFrame } = useStudio()
  return (
    <div className="pointer-events-none absolute grid place-items-center" style={{ inset: `${CHROME.top}px ${rightInset}px ${CHROME.bottom}px ${leftInset}px` }}>
      <div className="pointer-events-auto flex max-w-sm flex-col items-center text-center">
        <div className="mb-5 grid size-14 place-items-center rounded-2xl bg-panel text-slate shadow-float">
          <PenLine size={22} strokeWidth={1.5} />
        </div>
        <h2 className="text-lg font-semibold tracking-tight">Nothing on the board yet</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-slate">
          Start a sketch or ask for a design in the Agents panel.
        </p>
        <div className="mt-5 flex gap-2">
          <Button variant="primary" onClick={() => addFrame('sketch')}>
            <PenLine size={14} /> Add sketch
          </Button>
        </div>
      </div>
    </div>
  )
}

const TOOLS: { id: Tool; label: string; key: string; Icon: typeof Hand }[] = [
  { id: 'select', label: 'Select', key: 'V', Icon: MousePointer2 },
  { id: 'hand', label: 'Hand', key: 'H', Icon: Hand },
  { id: 'frame', label: 'Frame', key: 'F', Icon: FrameIcon },
  { id: 'rect', label: 'Rectangle', key: 'R', Icon: Square },
  { id: 'ellipse', label: 'Ellipse', key: 'O', Icon: Circle },
  { id: 'path', label: 'Pen', key: 'P', Icon: PenTool },
  { id: 'text', label: 'Text', key: 'T', Icon: Type },
]

type Mode = 'edit' | 'prototype' | 'comment'

/** The tool rail: tools on top, then the mode the board is in. Hold Z to zoom. */
function Tools({ left, onShowLayers }: { left: number; onShowLayers?: () => void }) {
  const { tool, setTool, prototype, setPrototype, addFrame, openWebsite } = useStudio()
  const mode: Mode = tool === 'comment' ? 'comment' : prototype ? 'prototype' : 'edit'
  const setMode = (m: Mode) => {
    if (m === 'comment') return setTool('comment')
    setPrototype(m === 'prototype')
    if (tool === 'comment' || m === 'prototype') setTool('select')
  }
  const modes: { id: Mode; label: string; hint: string; key?: string; Icon: typeof Hand }[] = [
    { id: 'edit', label: 'Edit', hint: 'Design mode', Icon: PencilRuler },
    { id: 'prototype', label: 'Prototype', hint: 'Link screens and play them', Icon: Route },
    { id: 'comment', label: 'Comment', hint: 'Comment', key: 'C', Icon: MessageCircle },
  ]
  return (
    <div className="panel editor-rail absolute z-10 flex flex-col items-center gap-0.5 p-1" style={{ left, top: 56 }}>
      {onShowLayers && (
        <>
          <IconButton label="Show the left panel" side="right" aria-expanded={false} aria-controls="studio-left-panel" onClick={onShowLayers}>
            <PanelLeftOpen size={16} strokeWidth={1.75} />
          </IconButton>
          <Separator className="editor-divider my-1 data-horizontal:w-5" />
        </>
      )}
      <div role="group" aria-label="Canvas tools" className="flex flex-col gap-0.5">
        {TOOLS.map(({ id, label, key, Icon }) => (
          <IconButton key={id} label={label} keys={[key]} side="right" className="editor-tool" active={tool === id} onClick={() => setTool(id)}>
            <Icon size={16} strokeWidth={1.75} />
          </IconButton>
        ))}
        <IconButton label="Add website" side="right" className="editor-tool" onClick={() => openWebsite()}>
          <Globe size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
      <Separator className="editor-divider my-1 data-horizontal:w-5" />
      <div role="radiogroup" aria-label="Mode" className="flex flex-col gap-0.5">
        {modes.map(({ id, label, hint, key, Icon }) => (
          <Tip key={id} label={hint} keys={key ? [key] : undefined} side="right">
            <button
              role="radio"
              aria-checked={mode === id}
              aria-label={label}
              onClick={() => setMode(id)}
              className="editor-control grid size-8 place-items-center"
            >
              <Icon size={16} strokeWidth={1.75} />
            </button>
          </Tip>
        ))}
      </div>
      {LIVE_FRAMES && (
        <IconButton label="Add live frame" keys={['A']} side="right" onClick={() => addFrame('live')}>
          <Radio size={16} strokeWidth={1.75} />
        </IconButton>
      )}
    </div>
  )
}

export function ZoomPill() {
  const { camera, setCamera, stageRef, fit, playerOpen } = useStudio()
  const zoomBy = (factor: number) => {
    const r = stageRef.current?.getBoundingClientRect()
    const px = (r?.width ?? 0) / 2
    const py = (r?.height ?? 0) / 2
    setCamera((c) => {
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.z * factor))
      return { z, x: px - ((px - c.x) / c.z) * z, y: py - ((py - c.y) / c.z) * z }
    })
  }
  const zoomRef = useRef(zoomBy)
  useEffect(() => {
    zoomRef.current = zoomBy
  })
  // ⌘+ and ⌘− zoom the board instead of the browser page.
  useEffect(() => {
    if (playerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        zoomRef.current(1.25)
      } else if (e.key === '-') {
        e.preventDefault()
        zoomRef.current(1 / 1.25)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playerOpen])
  return (
    <div className="panel flex items-center gap-0.5 p-1">
      <IconButton label="Zoom out" keys={['⌘', '−']} side="top" onClick={() => zoomBy(1 / 1.25)}>
        <Minus size={15} strokeWidth={1.75} />
      </IconButton>
      <Tip label="Fit everything" keys={['⇧', '1']} side="top">
        <button onClick={fit} className="editor-control h-8 min-w-12 px-1 text-xs font-medium tabular-nums">
          {Math.round(camera.z * 100)}%
        </button>
      </Tip>
      <IconButton label="Zoom in" keys={['⌘', '+']} side="top" onClick={() => zoomBy(1.25)}>
        <Plus size={15} strokeWidth={1.75} />
      </IconButton>
    </div>
  )
}
