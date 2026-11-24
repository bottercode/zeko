import type { ShapeKind } from '../types'

/* Drawing on the board. A shape drawn on bare canvas becomes its own frame: a
   transparent document the shape fills, so it moves, resizes, layers and
   exports like any frame. Drawn over a sketch, it goes into that sketch's
   HTML instead, placed absolutely where it was drawn. */

export interface Point {
  x: number
  y: number
}
/** A pen anchor, with the handle a drag pulled out of it (mirrored on the incoming side). */
export interface Anchor extends Point {
  hx?: number
  hy?: number
}
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** On bare canvas the ink is light, to read on the dark table; inside a page it is dark. */
export const INK_CANVAS = '#f1f1f3'
export const INK_PAGE = '#1b1c1f'
export const FILL = '#d4d5da'
export const STROKE = 2

/** The box a drag describes, on whole pixels. Shift keeps it square. */
export function dragBox(a: Point, b: Point, square: boolean): Box {
  let w = b.x - a.x
  let h = b.y - a.y
  if (square) {
    const s = Math.max(Math.abs(w), Math.abs(h))
    w = Math.sign(w || 1) * s
    h = Math.sign(h || 1) * s
  }
  const x = Math.round(Math.min(a.x, a.x + w))
  const y = Math.round(Math.min(a.y, a.y + h))
  return { x, y, w: Math.round(Math.abs(w)), h: Math.round(Math.abs(h)) }
}

/** Shift on the pen: the next segment snaps to 45° steps from the last anchor. */
export function snap45(from: Point, to: Point): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
  return { x: from.x + Math.cos(angle) * len, y: from.y + Math.sin(angle) * len }
}

/** An SVG path through the anchors, curved where a drag pulled handles out. */
export function pathData(anchors: Anchor[], closed: boolean, offset: Point = { x: 0, y: 0 }): string {
  if (anchors.length === 0) return ''
  const p = (n: number, o: number) => Math.round((n - o) * 10) / 10
  const pt = (a: Point) => `${p(a.x, offset.x)} ${p(a.y, offset.y)}`
  const out = (a: Anchor): Point => (a.hx === undefined ? a : { x: a.hx, y: a.hy! })
  const inn = (a: Anchor): Point => (a.hx === undefined ? a : { x: 2 * a.x - a.hx, y: 2 * a.y - a.hy! })
  const segment = (from: Anchor, to: Anchor) =>
    from.hx === undefined && to.hx === undefined ? `L ${pt(to)}` : `C ${pt(out(from))} ${pt(inn(to))} ${pt(to)}`
  let d = `M ${pt(anchors[0]!)}`
  for (let i = 1; i < anchors.length; i++) d += ` ${segment(anchors[i - 1]!, anchors[i]!)}`
  if (closed && anchors.length > 2) d += ` ${segment(anchors.at(-1)!, anchors[0]!)} Z`
  return d
}

/** The bounds of a path's anchors and handles, padded so a straight line's stroke stays visible. */
export function pathBounds(anchors: Anchor[]): Box {
  const xs: number[] = []
  const ys: number[] = []
  for (const a of anchors) {
    xs.push(a.x)
    ys.push(a.y)
    if (a.hx !== undefined) xs.push(a.hx, 2 * a.x - a.hx)
    if (a.hy !== undefined) ys.push(a.hy, 2 * a.y - a.hy)
  }
  const pad = 4
  const x = Math.floor(Math.min(...xs) - pad)
  const y = Math.floor(Math.min(...ys) - pad)
  return { x, y, w: Math.ceil(Math.max(...xs) + pad) - x, h: Math.ceil(Math.max(...ys) + pad) - y }
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const TEXT_FONT = '400 24px/1.3 ui-sans-serif, system-ui, sans-serif'

/** The element for a shape, as markup. `fill` sizes it to its container (a shape frame); otherwise it carries its own box. */
function shapeMarkup(kind: ShapeKind, opts: { ink: string; box?: Box; d?: string; text?: string; viewBox?: Box; align?: 'right' }): string {
  const place = opts.box ? `position:absolute;left:${opts.box.x}px;top:${opts.box.y}px;width:${opts.box.w}px;height:${opts.box.h}px;` : 'width:100%;height:100%;'
  switch (kind) {
    case 'rect':
      return `<div data-zeko-shape="rect" style="${place}background:${FILL}"></div>`
    case 'ellipse':
      return `<div data-zeko-shape="ellipse" style="${place}background:${FILL};border-radius:50%"></div>`
    case 'path': {
      const vb = opts.viewBox!
      return `<svg data-zeko-shape="path" style="${place}display:block;overflow:visible" viewBox="0 0 ${vb.w} ${vb.h}" preserveAspectRatio="none"><path d="${opts.d}" fill="none" stroke="${opts.ink}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`
    }
    case 'text':
      return `<p data-zeko-shape="text" style="${opts.box ? `position:absolute;left:${opts.box.x}px;top:${opts.box.y}px;` : ''}margin:0;font:${TEXT_FONT};color:${opts.ink};white-space:pre${opts.align ? ';text-align:right' : ''}">${escapeHtml(opts.text ?? '')}</p>`
  }
}

/** A standalone shape's document: transparent, with the shape filling it. */
export function shapeDocument(kind: ShapeKind, opts: { d?: string; text?: string; viewBox?: Box; align?: 'right' } = {}): string {
  return `<!doctype html><html><head><meta name="color-scheme" content="dark"><style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}</style></head><body>${shapeMarkup(kind, { ...opts, ink: INK_CANVAS })}</body></html>`
}

export function readTextShape(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const text = doc.querySelector<HTMLElement>('[data-zeko-shape="text"]')
  if (!text) return undefined
  for (const br of text.querySelectorAll('br')) br.replaceWith('\n')
  return { value: text.textContent ?? '', font: text.style.font || TEXT_FONT, ink: text.style.color || INK_CANVAS, rightAligned: text.style.textAlign === 'right' }
}

export function editTextShape(html: string, value: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const text = doc.querySelector<HTMLElement>('[data-zeko-shape="text"]')
  if (!text) return html
  text.textContent = value
  return `<!doctype html>\n${doc.documentElement.outerHTML}`
}

/** Puts a shape into a sketch at `box`, in the sketch's own pixels. Returns the new HTML. */
export function insertShape(html: string, kind: ShapeKind, box: Box, opts: { d?: string; text?: string; viewBox?: Box } = {}): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const tpl = doc.createElement('template')
  tpl.innerHTML = shapeMarkup(kind, { ...opts, box, ink: INK_PAGE })
  const el = tpl.content.firstElementChild!
  // Above the page's own content, which may have its own stacking.
  ;(el as HTMLElement).style.setProperty('z-index', '1')
  doc.body.appendChild(el)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? '<!doctype html>'
  return `${doctype}\n${doc.documentElement.outerHTML}`
}

/** How big a piece of text sets in the canvas font. */
export function measureText(text: string, font = TEXT_FONT): { w: number; h: number } {
  const ctx = document.createElement('canvas').getContext('2d')!
  ctx.font = font.replace(/px\s*\/\s*\S+/, 'px')
  const lines = text.split('\n')
  const w = Math.max(8, ...lines.map((l) => ctx.measureText(l).width))
  const size = Number.parseFloat(font.match(/[\d.]+(?=px)/)?.[0] ?? '24')
  return { w: Math.ceil(w) + 2, h: Math.ceil(lines.length * size * 1.3) }
}

export const SHAPE_NAMES: Record<ShapeKind, string> = { rect: 'Rectangle', ellipse: 'Ellipse', path: 'Path', text: 'Text' }
