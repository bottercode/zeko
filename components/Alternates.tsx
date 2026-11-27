'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { Check, GitBranch, Send, X } from 'lucide-react'
import { alternatesRequest, alternateTree, generations, type AlternateNode } from '@/lib/alternates'
import { deckFront } from '@/lib/ops'
import { ago } from '@/lib/client/useBoard'
import { tokenCss } from '@/lib/tokens'
import type { Frame } from '@/lib/types'
import { useFrameActions } from './actions'
import { FrameSurface } from './FrameCard'
import { cx } from './kit'
import { useStudio } from './studio-context'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

const CARD_W = 248
const THUMB_MAX_H = 150

/** A frame's alternates as a tree: what branched from what, which one the canvas shows, and a way to ask for more. */
export function Alternates({ frameId, onClose }: { frameId: string; onClose: () => void }) {
  const { board, dispatch, select, flyTo, confirm } = useStudio()
  const act = useFrameActions()
  const frame = board.frames.find((f) => f.id === frameId)
  const nodes = frame ? alternateTree(board, frame) : []
  const rows = generations(nodes)
  const shown = frame?.deckId ? deckFront(board, frame.deckId) : frame
  const [fromId, setFromId] = useState(shown?.id ?? frameId)
  const from = nodes.find((n) => n.frame.id === fromId)?.frame ?? shown ?? frame
  const [direction, setDirection] = useState('')
  const [count, setCount] = useState('3')
  const [waiting, setWaiting] = useState<{ until: number } | null>(null)
  const close = useRef<HTMLButtonElement>(null)

  // Connectors from each alternate to the one it branched from, measured once the cards are laid out.
  // A callback ref: the dialog mounts its content after this component's first layout.
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  const cards = useRef(new Map<string, HTMLElement>())
  const [lines, setLines] = useState<{ key: string; d: string }[]>([])
  const layoutKey = nodes.map((n) => `${n.frame.id}<${n.parent?.id ?? ''}`).join(',')
  useLayoutEffect(() => {
    const el = stage
    if (!el) return
    const measure = () => {
      const base = el.getBoundingClientRect()
      const next: { key: string; d: string }[] = []
      for (const node of nodes) {
        const child = cards.current.get(node.frame.id)?.getBoundingClientRect()
        const parent = node.parent && cards.current.get(node.parent.id)?.getBoundingClientRect()
        if (!child || !parent) continue
        const x1 = parent.left + parent.width / 2 - base.left
        const y1 = parent.bottom - base.top
        const x2 = child.left + child.width / 2 - base.left
        const y2 = child.top - base.top
        const mid = (y1 + y2) / 2
        next.push({ key: node.frame.id, d: `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}` })
      }
      setLines(next)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    for (const card of cards.current.values()) ro.observe(card)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, layoutKey])

  if (!frame || !from) return null
  const root = rows[0]?.[0]?.frame ?? frame
  const pending = waiting ? Math.max(0, waiting.until - nodes.length) : 0

  const show = (f: Frame) => {
    if (f.deckId) dispatch({ type: 'deck.front', deckId: f.deckId, frameId: f.id })
    select([f.id])
  }
  const keepOnly = (f: Frame) => confirm({
    title: `Keep only “${f.name}”?`,
    body: `The other ${nodes.length - 1} alternate${nodes.length === 2 ? '' : 's'} will be removed from the canvas. ⌘Z brings them back.`,
    confirm: 'Keep this one',
    onConfirm: () => {
      act.keep(f)
      onClose()
    },
  })
  const ask = () => {
    const n = Number(count)
    act.askAgent(alternatesRequest(from, n, direction), [from.id], `alternates-${root.id}`)
    setWaiting({ until: nodes.length + n })
    setDirection('')
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent fullscreen showCloseButton={false} initialFocus={close} className="bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-3 px-5 py-3">
          <GitBranch size={16} className="text-muted-foreground" aria-hidden />
          <DialogTitle>Alternates of {root.name.replace(/ · v\d+$/, '')}</DialogTitle>
          <span className="text-sm text-muted-foreground tabular-nums">{nodes.length === 1 ? 'Just the original so far' : `${nodes.length} versions`}</span>
          <Button ref={close} variant="ghost" size="icon" aria-label="Close" className="ml-auto" onClick={onClose}>
            <X size={17} />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
          <div ref={setStage} className="relative mx-auto flex w-max min-w-full flex-col items-center gap-12 pt-2 pb-4">
            <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
              {lines.map((line) => <path key={line.key} d={line.d} fill="none" stroke="currentColor" strokeDasharray="4 4" className="text-mist" />)}
            </svg>
            {rows.map((row, depth) => (
              <ol key={depth} className="relative flex items-start justify-center gap-6" aria-label={depth === 0 ? 'Original' : `Generation ${depth}`}>
                {row.map((node) => (
                  <AlternateCard key={node.frame.id} node={node} shown={node.frame.id === shown?.id} branching={node.frame.id === from.id}
                    cardRef={(el) => { if (el) cards.current.set(node.frame.id, el); else cards.current.delete(node.frame.id) }}
                    onShow={() => show(node.frame)}
                    onOpen={() => { show(node.frame); flyTo(node.frame); onClose() }}
                    onBranch={() => setFromId(node.frame.id)}
                    onKeep={nodes.length > 1 ? () => keepOnly(node.frame) : undefined} />
                ))}
              </ol>
            ))}
          </div>
        </div>

        <form className="mx-auto mb-5 flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-xl border border-hair bg-panel p-2 shadow-pop"
          onSubmit={(e) => { e.preventDefault(); ask() }}>
          <span className="flex min-w-0 items-center gap-1.5 pl-1.5 text-xs text-muted-foreground">
            <GitBranch size={13} aria-hidden /> From <span className="max-w-40 truncate font-medium text-foreground">{from.name}</span>
          </span>
          <Input aria-label="Direction for the alternates" value={direction} onChange={(e) => setDirection(e.currentTarget.value)}
            placeholder="Direction, e.g. denser, more playful, a sidebar layout (optional)" className="h-8 min-w-56 flex-1 text-sm" />
          <ToggleGroup aria-label="How many alternates" size="sm" value={[count]} onValueChange={([next]) => { if (next) setCount(next) }}>
            {['2', '3', '4'].map((n) => <ToggleGroupItem key={n} value={n} aria-label={`${n} alternates`}>{n}</ToggleGroupItem>)}
          </ToggleGroup>
          <Button type="submit" size="sm"><Send data-icon="inline-start" aria-hidden /> Ask agent</Button>
          {pending > 0 && <p className="w-full px-1.5 text-xs text-muted-foreground" role="status">Your agent is making {pending} more. They appear here as they arrive.</p>}
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AlternateCard({ node, shown, branching, cardRef, onShow, onOpen, onBranch, onKeep }: {
  node: AlternateNode
  shown: boolean
  branching: boolean
  cardRef: (el: HTMLElement | null) => void
  onShow: () => void
  onOpen: () => void
  onBranch: () => void
  onKeep?: () => void
}) {
  const { board, now } = useStudio()
  const f = node.frame
  const scale = CARD_W / f.w
  const height = Math.min(THUMB_MAX_H, f.h * scale)
  return (
    <li ref={cardRef} className={cx('group flex flex-col gap-1.5 rounded-xl border bg-panel p-1.5 shadow-sm', shown ? 'border-grease ring-2 ring-grease/30' : 'border-hair')} style={{ width: CARD_W + 14 }}>
      <button type="button" onClick={onShow} onDoubleClick={onOpen} aria-pressed={shown} aria-label={`Show “${f.name}” on the canvas`}
        className="relative overflow-hidden rounded-lg bg-white text-left outline-none focus-visible:ring-2 focus-visible:ring-grease" style={{ width: CARD_W, height }}>
        <div inert className="absolute top-0 left-0 origin-top-left" style={{ width: f.w, height: f.h, transform: `scale(${scale})` }}>
          <FrameSurface frame={f} appUrl={board.appUrl} css={tokenCss(board.design)} />
        </div>
        {shown && <span className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-md bg-grease px-1.5 py-0.5 text-2xs font-medium text-white"><Check size={11} aria-hidden /> On canvas</span>}
      </button>
      <div className="flex min-w-0 items-start gap-1 px-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium" title={f.name}>{f.name}</span>
          <span className="truncate text-2xs text-muted-foreground">{f.createdBy.name} · {ago(f.createdAt, now)}</span>
        </div>
      </div>
      <div className="flex gap-1 px-0.5 pb-0.5">
        <Button size="xs" variant={branching ? 'secondary' : 'ghost'} aria-pressed={branching} onClick={onBranch}>
          <GitBranch data-icon="inline-start" aria-hidden /> {branching ? 'Branching' : 'Branch'}
        </Button>
        <Button size="xs" variant="ghost" onClick={onOpen}>Open</Button>
        {onKeep && <Button size="xs" variant="ghost" className="ml-auto" onClick={onKeep}>Keep only</Button>}
      </div>
    </li>
  )
}
