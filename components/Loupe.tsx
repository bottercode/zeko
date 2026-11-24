'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, X } from 'lucide-react'
import type { Frame } from '@/lib/types'
import { FrameSurface } from './FrameCard'
import { useStudio } from './studio-context'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { Slider } from './ui/slider'

type Mode = 'wipe' | 'through' | 'side'

const MODES: { id: Mode; label: string }[] = [
  { id: 'wipe', label: 'Wipe' },
  { id: 'through', label: 'See-through' },
  { id: 'side', label: 'Side by side' },
]

/** Two frames on top of each other, so the difference is the thing you look at. */
export function Loupe({ ids, onClose, onSwap }: { ids: [string, string]; onClose: () => void; onSwap: () => void }) {
  const { board } = useStudio()
  const a = board.frames.find((f) => f.id === ids[0])
  const b = board.frames.find((f) => f.id === ids[1])
  const [mode, setMode] = useState<Mode>('wipe')
  const [split, setSplit] = useState(0.5)
  const [opacity, setOpacity] = useState(0.5)
  const stage = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const [size, setSize] = useState({ w: 1200, h: 700 })
  const dragging = useRef(false)

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => entry && setSize({ w: entry.contentRect.width, h: entry.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!a || !b) return null

  const side = mode === 'side'
  const gap = 32
  const scale = side
    ? Math.min((size.w - gap) / (a.w + b.w), size.h / Math.max(a.h, b.h))
    : Math.min(size.w / a.w, size.h / a.h)

  const setFromPointer = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    setSplit(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)))
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent fullscreen showCloseButton={false} initialFocus={close} className="bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-3 px-5 py-3 text-white">
          <DialogTitle>Compare frames</DialogTitle>
          <ToggleGroup aria-label="Comparison mode" size="sm" value={[mode]} onValueChange={([next]) => { if (next) setMode(next as Mode) }}>
            {MODES.map((m) => (
              <ToggleGroupItem key={m.id} value={m.id}>
                {m.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {mode === 'through' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {b.name}
              <Slider aria-label="Comparison opacity" min={0} max={1} step={0.01} value={[opacity]}
                onValueChange={(value) => setOpacity(typeof value === 'number' ? value : value[0]!)} className="w-40" />
            </div>
          )}
          <Button variant="ghost" onClick={onSwap} className="ml-auto">
            <ArrowLeftRight data-icon="inline-start" aria-hidden /> Swap
          </Button>
          <Button ref={close} variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X size={17} />
          </Button>
        </div>

        <div ref={stage} className="relative min-h-0 flex-1 mx-6 mb-6">
          <div className="absolute inset-0 grid place-items-center">
            {side ? (
              <div className="flex items-start" style={{ gap }}>
                <Plate frame={a} scale={scale} caption={a.name} />
                <Plate frame={b} scale={scale} caption={b.name} />
              </div>
            ) : (
              <div className="relative" style={{ width: a.w * scale, height: a.h * scale }}>
                <Plate frame={a} scale={scale} />
                <div
                  className="absolute inset-0"
                  style={{
                    clipPath: mode === 'wipe' ? `inset(0 0 0 ${split * 100}%)` : undefined,
                    opacity: mode === 'through' ? opacity : 1,
                  }}
                >
                  <Plate frame={b} scale={scale} width={a.w} height={a.h} />
                </div>
                {mode === 'wipe' && (
                  <div
                    className="absolute inset-0 cursor-ew-resize touch-none"
                    onPointerDown={(e) => {
                      dragging.current = true
                      e.currentTarget.setPointerCapture(e.pointerId)
                      setFromPointer(e)
                    }}
                    onPointerMove={(e) => dragging.current && setFromPointer(e)}
                    onPointerUp={() => (dragging.current = false)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowLeft') setSplit((s) => Math.max(0, s - 0.02))
                      if (e.key === 'ArrowRight') setSplit((s) => Math.min(1, s + 0.02))
                      if (e.key === 'Home') setSplit(0)
                      if (e.key === 'End') setSplit(1)
                      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) e.preventDefault()
                    }}
                    role="slider"
                    tabIndex={0}
                    aria-label="Divider between the two frames"
                    aria-valuenow={Math.round(split * 100)}
                  >
                    <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-grease" style={{ left: `${split * 100}%` }}>
                      <span className="absolute top-1/2 left-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-grease text-white shadow-pop">
                        <ArrowLeftRight size={14} />
                      </span>
                    </div>
                    <span className="absolute top-3 left-3 rounded-md bg-black/70 px-2 py-1 text-xs text-white">{a.name}</span>
                    <span className="absolute top-3 right-3 rounded-md bg-black/70 px-2 py-1 text-xs text-white">{b.name}</span>
                  </div>
                )}
                {mode === 'through' && <div className="absolute inset-0" />}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Plate({ frame, scale, caption, width, height }: { frame: Frame; scale: number; caption?: string; width?: number; height?: number }) {
  const { board } = useStudio()
  const w = width ?? frame.w
  const h = height ?? frame.h
  return (
    <figure className="m-0">
      <div className="relative overflow-hidden rounded-sm bg-white shadow-pop" style={{ width: w * scale, height: h * scale }}>
        <div inert className="absolute top-0 left-0 origin-top-left" style={{ width: w, height: h, transform: `scale(${scale})` }}>
          <FrameSurface frame={frame} appUrl={board.appUrl} />
        </div>
      </div>
      {caption && <figcaption className="mt-2 text-sm text-white/80">{caption}</figcaption>}
    </figure>
  )
}
