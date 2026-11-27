'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Flag, Send, Waypoints, X } from 'lucide-react'
import { missingStateRequest, NODE, stateMap, type MissingState, type StateEdge, type StateNode } from '@/lib/state-map'
import { useFrameActions } from './actions'
import { cx } from './kit'
import { LINK } from './ProtoLinks'
import { useStudio } from './studio-context'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

const PAD = 24

/** Every screen and state of the page along its prototype links, and the states screens still need. */
export function StateMapView({ onClose }: { onClose: () => void }) {
  const { board, pageId, select, flyTo } = useStudio()
  const act = useFrameActions()
  const map = useMemo(() => stateMap(board, pageId), [board, pageId])
  const [hover, setHover] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const close = useRef<HTMLButtonElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState({ w: 1000, h: 700 })
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => entry && setRoom({ w: entry.contentRect.width, h: entry.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const byId = new Map(map.nodes.map((n) => [n.id, n]))
  const screens = new Set(map.nodes.map((n) => n.screen)).size
  const scale = Math.max(0.5, Math.min(1, (room.w - PAD * 2) / Math.max(1, map.width), (room.h - PAD * 2) / Math.max(1, map.height)))
  const keyOf = (m: MissingState) => `${m.route}:${m.state}`
  const chosen = map.missing.filter((m) => picked.has(keyOf(m)))

  const open = (node: StateNode) => {
    select([node.frame.id])
    flyTo(node.frame)
    onClose()
  }
  const ask = (items: MissingState[]) => {
    if (!items.length) return
    act.askAgent(missingStateRequest(items), [...new Set(items.map((m) => m.near.id))], `states-${pageId}`)
    setPicked(new Set())
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent fullscreen showCloseButton={false} initialFocus={close} className="bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-3 px-5 py-3">
          <Waypoints size={16} className="text-muted-foreground" aria-hidden />
          <DialogTitle>State map</DialogTitle>
          <span className="text-sm text-muted-foreground tabular-nums">
            {screens} {screens === 1 ? 'screen' : 'screens'} · {map.nodes.length} {map.nodes.length === 1 ? 'state' : 'states'} · {map.edges.length} {map.edges.length === 1 ? 'link' : 'links'}
          </span>
          <Button ref={close} variant="ghost" size="icon" aria-label="Close" className="ml-auto" onClick={onClose}>
            <X size={17} />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 gap-4 px-5 pb-5">
          <div ref={stage} className="relative min-h-0 flex-1 overflow-auto rounded-xl border border-hair bg-panel/60">
            {!map.nodes.length ? (
              <p className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-muted-foreground">
                No screens on this page yet. Add sketches, give them a route and state, and link them in prototype mode.
              </p>
            ) : (
              <div className="relative mx-auto" style={{ width: map.width * scale + PAD * 2, height: map.height * scale + PAD * 2 }}>
                <div className="absolute origin-top-left" style={{ left: PAD, top: PAD, width: map.width, height: map.height, transform: `scale(${scale})` }}>
                  <svg className="pointer-events-none absolute inset-0 overflow-visible" width={map.width} height={map.height} aria-hidden>
                    <defs>
                      <marker id="zeko-map-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill={LINK} />
                      </marker>
                    </defs>
                    {map.edges.map((edge) => {
                      const a = byId.get(edge.from)
                      const b = byId.get(edge.to)
                      if (!a || !b) return null
                      const lit = !hover || hover === edge.from || hover === edge.to
                      return <path key={`${edge.from}>${edge.to}`} d={route(a, b)} fill="none" stroke={LINK} strokeWidth={edge.count > 1 ? 2 : 1.5}
                        markerEnd="url(#zeko-map-arrow)" opacity={lit ? 0.9 : 0.15} />
                    })}
                  </svg>
                  {map.nodes.map((node) => (
                    <button key={node.id} type="button" onClick={() => open(node)} onPointerEnter={() => setHover(node.id)} onPointerLeave={() => setHover(null)}
                      onFocus={() => setHover(node.id)} onBlur={() => setHover(null)}
                      aria-label={`${node.screen}, ${node.state}: open “${node.frame.name}”${linkSummary(node, map.edges)}`}
                      className={cx('absolute flex flex-col justify-center gap-1 rounded-lg border bg-background px-2.5 text-left shadow-sm transition-colors outline-none hover:border-grease focus-visible:ring-2 focus-visible:ring-grease',
                        node.id === map.start ? 'border-grease/70' : 'border-hair', hover && hover !== node.id && !connected(hover, node.id, map.edges) && 'opacity-40')}
                      style={{ left: node.x, top: node.y, width: NODE.w, height: NODE.h }}>
                      <span className="flex min-w-0 items-center gap-1.5">
                        {node.id === map.start && <Flag size={11} className="shrink-0 text-grease" aria-hidden />}
                        <span className="min-w-0 truncate font-mono text-xs">{node.screen}</span>
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className={cx('shrink-0 rounded px-1.5 text-2xs leading-4', node.state === 'default' ? 'bg-wash text-slate' : 'bg-grease-soft text-grease')}>{node.state}</span>
                        <span className="min-w-0 truncate text-2xs text-muted-foreground">{node.frame.name}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto rounded-xl border border-hair bg-panel p-3" aria-label="Missing states">
            <div>
              <h3 className="text-sm font-semibold">Missing states</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Screens with a route usually need loading, empty and error states too.</p>
            </div>
            {!map.missing.length ? (
              <p className="text-xs text-muted-foreground">{map.nodes.some((n) => n.frame.route) ? 'Every routed screen has its loading, empty and error states.' : 'Give screens a route to see which states they lack.'}</p>
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {[...new Set(map.missing.map((m) => m.route))].map((routeName) => (
                    <li key={routeName} className="flex flex-col gap-1">
                      <span className="truncate font-mono text-xs">{routeName}</span>
                      <span className="flex flex-wrap gap-1">
                        {map.missing.filter((m) => m.route === routeName).map((m) => {
                          const key = keyOf(m)
                          const on = picked.has(key)
                          return (
                            <button key={key} type="button" aria-pressed={on} aria-label={`${m.state} state of ${m.route}`}
                              onClick={() => setPicked((cur) => {
                                const next = new Set(cur)
                                if (on) next.delete(key)
                                else next.add(key)
                                return next
                              })}
                              className={cx('rounded-md border border-dashed px-2 py-0.5 text-2xs transition-colors', on ? 'border-grease bg-grease-soft text-grease' : 'border-hair text-muted-foreground hover:text-foreground')}>
                              + {m.state}
                            </button>
                          )
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" disabled={!chosen.length} onClick={() => ask(chosen)}>
                    <Send data-icon="inline-start" aria-hidden /> {chosen.length ? `Design ${chosen.length} with agent` : 'Pick states to design'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPicked(picked.size === map.missing.length ? new Set() : new Set(map.missing.map(keyOf)))}>
                    {picked.size === map.missing.length ? 'Clear' : 'Select all'}
                  </Button>
                </div>
              </>
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function connected(a: string, b: string, edges: StateEdge[]) {
  return edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a))
}

function linkSummary(node: StateNode, edges: StateEdge[]) {
  const out = edges.filter((e) => e.from === node.id).length
  const into = edges.filter((e) => e.to === node.id).length
  return out || into ? `, ${out} out, ${into} in` : ''
}

/** Downward links run bottom to top; links within a row arc over it; links back up loop around the side. */
function route(a: StateNode, b: StateNode) {
  if (b.level > a.level) {
    const x1 = a.x + NODE.w / 2, y1 = a.y + NODE.h, x2 = b.x + NODE.w / 2, y2 = b.y - 2
    const mid = (y1 + y2) / 2
    return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`
  }
  if (b.level === a.level) {
    const right = b.x > a.x
    const x1 = right ? a.x + NODE.w : a.x, x2 = right ? b.x : b.x + NODE.w
    const y = a.y + NODE.h / 2
    const lift = Math.min(60, 18 + Math.abs(x2 - x1) / 6)
    return `M ${x1} ${y} C ${x1 + (right ? 20 : -20)} ${y - lift}, ${x2 + (right ? -20 : 20)} ${y - lift}, ${x2 + (right ? -2 : 2)} ${y}`
  }
  // Back up the map: around the outside, on the side the link starts from, so it passes no other screen.
  const right = a.x >= b.x
  const x1 = right ? a.x + NODE.w : a.x, x2 = right ? b.x + NODE.w : b.x
  const y1 = a.y + NODE.h / 2, y2 = b.y + NODE.h / 2
  const out = right ? Math.max(a.x, b.x) + NODE.w + 56 : Math.min(a.x, b.x) - 56
  return `M ${x1} ${y1} C ${out} ${y1}, ${out} ${y2}, ${x2 + (right ? 2 : -2)} ${y2}`
}
