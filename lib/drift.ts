import { parseColor } from './color'
import type { DriftItem, DriftKind } from './types'

/*
 * Design drift: how an implemented page differs from the design it builds. Both pages are measured in a browser
 * (lib/server/drift.ts); this file matches their elements and compares them. It is pure, so it runs the same in
 * tests, on the server and for agents.
 */

/** One rendered element, measured in document pixels. */
export interface DriftElement {
  path: string
  tag: string
  /** the element's own text, whitespace collapsed */
  text: string
  x: number
  y: number
  w: number
  h: number
  color: string
  background: string
  borderColor: string
  borderWidth: number
  radius: number
  fontFamily: string
  fontSize: number
  fontWeight: number
  /** draws a surface: a background, border or shadow */
  surface: boolean
  /** fixed or sticky, or inside such an element: placed by the window, not the page */
  pinned?: boolean
}

export interface DriftPage {
  width: number
  height: number
  elements: DriftElement[]
}

export interface DriftOptions {
  /** design token name → the color it resolves to in the design */
  tokens?: Record<string, string>
}

const GRAPHIC = new Set(['img', 'svg', 'canvas', 'video', 'picture'])
const FIELD = new Set(['input', 'textarea', 'select'])
const SYSTEM_FONTS = new Set(['system-ui', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica neue', 'helvetica', 'arial', 'sans-serif', 'ui-sans-serif', 'inter var'])

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim()
const px = (n: number) => `${Math.round(n * 10) / 10}px`
const quote = (text: string) => `“${text.length > 36 ? `${text.slice(0, 34)}…` : text}”`
const family = (value: string) => {
  const first = value.split(',')[0]!.trim().replace(/^["']|["']$/g, '').toLowerCase()
  return SYSTEM_FONTS.has(first) ? 'system sans' : first
}
const familyLabel = (value: string) => value.split(',')[0]!.trim().replace(/^["']|["']$/g, '')

/** Perceptual distance between two CSS colors in OKLab; transparent colors count as equal to each other. */
export function colorDistance(a: string, b: string): number {
  const x = parseColor(a)
  const y = parseColor(b)
  if (!x || !y) return a === b ? 0 : 1
  if (x.a < 0.02 && y.a < 0.02) return 0
  const lab = (c: { l: number; c: number; h: number }) => [c.l, c.c * Math.cos((c.h * Math.PI) / 180), c.c * Math.sin((c.h * Math.PI) / 180)]
  const [l1, a1, b1] = lab(x)
  const [l2, a2, b2] = lab(y)
  return Math.hypot(l1! - l2!, a1! - a2!, b1! - b2!) + Math.abs(x.a - y.a) * 0.5
}

const visible = (color: string) => (parseColor(color)?.a ?? 1) > 0.02
const sameColor = (a: string, b: string) => colorDistance(a, b) < 0.02

/** The token whose color this is, if the design's color comes from one. */
function tokenFor(color: string, tokens: Record<string, string>) {
  for (const [name, value] of Object.entries(tokens)) if (sameColor(color, value)) return name
  return undefined
}

function similarity(a: string, b: string) {
  const left = new Set(a.split(' '))
  const right = new Set(b.split(' '))
  const shared = [...left].filter((word) => right.has(word)).length
  return shared / Math.max(left.size, right.size)
}

const isAncestor = (ancestor: string, path: string) => ancestor === '' || path.startsWith(ancestor + '.')

/** Pairs design and build elements: text by content, graphics and fields by order, surfaces by what they contain. */
export function matchElements(design: DriftPage, build: DriftPage) {
  const pairs = new Map<DriftElement, DriftElement>()
  const used = new Set<DriftElement>()
  const byOrder = (list: DriftElement[]) => [...list].sort((a, b) => a.y - b.y || a.x - b.x)

  // Text, exact: the k-th “Start free trial” in the design is the k-th in the build.
  const designTexts = byOrder(design.elements.filter((e) => e.text))
  const buildTexts = byOrder(build.elements.filter((e) => e.text))
  const pool = new Map<string, DriftElement[]>()
  for (const e of buildTexts) pool.set(norm(e.text), [...(pool.get(norm(e.text)) ?? []), e])
  for (const e of designTexts) {
    const match = pool.get(norm(e.text))?.shift()
    if (match) { pairs.set(e, match); used.add(match) }
  }

  // Text, reworded: a close match in about the same place is the same element with different copy.
  const reworded = new Map<DriftElement, DriftElement>()
  for (const e of designTexts) {
    if (pairs.has(e)) continue
    let best: DriftElement | undefined
    let bestScore = 0
    for (const candidate of buildTexts) {
      if (used.has(candidate)) continue
      const words = similarity(norm(e.text), norm(candidate.text))
      const place = 1 - Math.min(1, Math.abs(e.y / design.height - candidate.y / build.height) * 4)
      const score = words * 0.7 + place * 0.3
      if (words >= 0.4 && score > bestScore) { best = candidate; bestScore = score }
    }
    if (best) { pairs.set(e, best); reworded.set(e, best); used.add(best) }
  }

  // Graphics and form fields, in reading order.
  for (const group of [GRAPHIC, FIELD]) {
    const left = byOrder(design.elements.filter((e) => group.has(e.tag) && !e.text))
    const right = byOrder(build.elements.filter((e) => group.has(e.tag) && !e.text && !used.has(e)))
    left.forEach((e, i) => { const match = right[i]; if (match) { pairs.set(e, match); used.add(match) } })
  }

  // Surfaces (cards, buttons, sections): the build element that holds the same matched content.
  const leaves = [...pairs.entries()]
  const buildByPath = new Map(build.elements.map((e) => [e.path, e]))
  for (const surface of design.elements.filter((e) => e.surface && !pairs.has(e))) {
    const inside = leaves.filter(([d]) => isAncestor(surface.path, d.path)).map(([, b]) => b)
    if (!inside.length) continue
    let common = inside[0]!.path
    for (const b of inside.slice(1)) {
      while (common && !(b.path === common || isAncestor(common, b.path))) common = common.split('.').slice(0, -1).join('.')
    }
    // Climb to the element that draws the surface: same size, or the first with a surface of its own.
    let candidate = buildByPath.get(common)
    let at = common
    while (at) {
      const here = buildByPath.get(at)
      if (here?.surface && !used.has(here)) { candidate = here; break }
      const parent = buildByPath.get(at.split('.').slice(0, -1).join('.'))
      if (!parent || !here || Math.abs(parent.w - here.w) > 8 || Math.abs(parent.h - here.h) > 8) break
      at = parent.path
    }
    if (candidate && !used.has(candidate)) { pairs.set(surface, candidate); used.add(candidate) }
  }

  return { pairs, reworded }
}

export function compareLayouts(design: DriftPage, build: DriftPage, options: DriftOptions = {}): { items: DriftItem[]; matched: number } {
  const tokens = options.tokens ?? {}
  const { pairs, reworded } = matchElements(design, build)
  const pin = (b: DriftElement) => ({ x: clamp01((b.x + Math.min(b.w, 24) / 2) / build.width), y: clamp01(b.y / build.height), buildPath: b.path })
  const raw: Raw[] = []
  const add: Add = (item) => { raw.push(item) }
  const name = (d: DriftElement) => describe(design, d)

  const colorItem = (d: DriftElement, b: DriftElement, property: 'color' | 'background' | 'borderColor', what: string, css: string) => {
    const want = d[property]
    const got = b[property]
    if (sameColor(want, got) || (!visible(want) && !visible(got))) return
    const token = visible(want) ? tokenFor(want, tokens) : undefined
    add({
      kind: token ? 'token' : 'color', property, prefix: `${what} of`, subject: name(d),
      design: token ? `var(--${token})` : want, build: got,
      fix: token ? `Set ${css} to the --${token} design token (var(--${token})) instead of ${got}.` : `Set ${css} to ${want} (now ${got}).`,
      designPath: d.path, ...pin(b),
    })
  }

  for (const [d, b] of pairs) {
    if (reworded.get(d) === b) {
      add({ kind: 'text', property: 'text', prefix: 'Copy of', subject: quote(d.text), design: d.text, build: b.text, fix: `Change the text “${b.text}” to “${d.text}”.`, designPath: d.path, ...pin(b) })
    }
    if (d.text) {
      const type: string[] = []
      if (family(d.fontFamily) !== family(b.fontFamily)) type.push('family')
      if (Math.abs(d.fontSize - b.fontSize) >= 1) type.push('size')
      if (Math.abs(d.fontWeight - b.fontWeight) >= 100) type.push('weight')
      if (type.length) {
        const label = (e: DriftElement) => `${familyLabel(e.fontFamily)} ${e.fontWeight} ${px(e.fontSize)}`
        add({
          kind: 'type', property: 'font', prefix: 'Type of', subject: name(d), design: label(d), build: label(b),
          fix: `Use ${[type.includes('family') && `font-family ${familyLabel(d.fontFamily)}`, type.includes('size') && `font-size ${px(d.fontSize)}`, type.includes('weight') && `font-weight ${d.fontWeight}`].filter(Boolean).join(', ')}.`,
          designPath: d.path, ...pin(b),
        })
      }
      colorItem(d, b, 'color', 'Text color', 'color')
    }
    const holdsContent = d.surface && [...pairs.keys()].some((other) => other !== d && isAncestor(d.path, other.path))
    if ((d.surface && !holdsContent) || GRAPHIC.has(d.tag) || FIELD.has(d.tag)) {
      const dw = Math.abs(d.w - b.w) > Math.max(4, d.w * 0.03)
      const dh = Math.abs(d.h - b.h) > Math.max(4, d.h * 0.03)
      if (dw || dh) {
        add({
          kind: 'size', property: 'size', prefix: 'Size of', subject: name(d), design: `${Math.round(d.w)} × ${Math.round(d.h)}`, build: `${Math.round(b.w)} × ${Math.round(b.h)}`,
          fix: `Make it ${[dw && `${Math.round(d.w)}px wide`, dh && `${Math.round(d.h)}px tall`].filter(Boolean).join(' and ')} (now ${Math.round(b.w)} × ${Math.round(b.h)}).`,
          designPath: d.path, ...pin(b),
        })
      }
    }
    if (d.surface) {
      colorItem(d, b, 'background', 'Background', 'background-color')
      if (d.borderWidth > 0 || b.borderWidth > 0) {
        if (Math.abs(d.borderWidth - b.borderWidth) >= 1) {
          add({ kind: 'size', property: 'border-width', prefix: 'Border width of', subject: name(d), design: px(d.borderWidth), build: px(b.borderWidth), fix: `Set border-width to ${px(d.borderWidth)}.`, designPath: d.path, ...pin(b) })
        } else colorItem(d, b, 'borderColor', 'Border color', 'border-color')
      }
      if (Math.abs(d.radius - b.radius) >= 2) {
        add({ kind: 'size', property: 'radius', prefix: 'Corner radius of', subject: name(d), design: px(d.radius), build: px(b.radius), fix: `Set border-radius to ${px(d.radius)}.`, designPath: d.path, ...pin(b) })
      }
    }
  }

  spacing(pairs, add, pin, name)

  // What the design has that the build doesn't, pinned where it should have been.
  const matchedDesign = [...pairs.keys()].sort((a, b) => a.y - b.y)
  for (const d of design.elements) {
    if (pairs.has(d) || !(d.text || GRAPHIC.has(d.tag) || FIELD.has(d.tag))) continue
    if (design.elements.some((other) => other !== d && other.text && pairs.has(other) && isAncestor(d.path, other.path))) continue
    const before = [...matchedDesign].reverse().find((m) => m.y + m.h <= d.y + 1)
    const anchor = before && pairs.get(before)
    const y = anchor ? anchor.y + anchor.h + (d.y - before!.y - before!.h) : (d.y / design.height) * build.height
    add({
      kind: 'missing', property: 'element', prefix: 'Missing', subject: d.text ? quote(d.text) : `the ${d.tag}`,
      design: d.text ? `<${d.tag}> ${d.text.slice(0, 60)}` : `<${d.tag}> ${Math.round(d.w)} × ${Math.round(d.h)}`, build: 'not found',
      fix: d.text ? `Add “${d.text}” (a <${d.tag}>) as in the design${before ? `, below ${quote(before.text || before.tag)}` : ''}.` : `Add the ${d.tag} from the design${before ? ` below ${quote(before.text || before.tag)}` : ''}.`,
      designPath: d.path, x: clamp01(d.x / design.width), y: clamp01(y / build.height),
    })
  }
  const matchedBuild = new Set(pairs.values())
  const extras = build.elements.filter((b) => b.text && b.text.length > 1 && !matchedBuild.has(b))
  for (const b of extras.slice(0, 12)) {
    add({ kind: 'extra', property: 'element', prefix: 'Not in the design:', subject: quote(b.text), design: 'not in the design', build: `<${b.tag}> ${b.text.slice(0, 60)}`, fix: `Remove ${quote(b.text)}, or add it to the design if it belongs.`, ...pin(b) })
  }

  const merged = mergeRepeats(raw)
  const order: Record<DriftKind, number> = { missing: 0, text: 1, spacing: 2, size: 3, type: 4, token: 5, color: 6, extra: 7 }
  merged.sort((a, b) => order[a.kind] - order[b.kind] || a.y - b.y || a.x - b.x)
  const seen = new Set<string>()
  return { items: merged.filter((item) => !seen.has(item.key) && seen.add(item.key)), matched: pairs.size }
}

/** Space between an element and its neighbor above (same column) or to its left (same row), design versus build. */
function spacing(
  pairs: Map<DriftElement, DriftElement>,
  add: Add,
  pin: (b: DriftElement) => { x: number; y: number; buildPath: string },
  name: (d: DriftElement) => string,
) {
  const placed = [...pairs.keys()].filter((d) => !d.pinned && !pairs.get(d)!.pinned && (d.text || d.surface || GRAPHIC.has(d.tag) || FIELD.has(d.tag)))
  const overlaps = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 2
  const related = (a: DriftElement, b: DriftElement) => isAncestor(a.path, b.path) || isAncestor(b.path, a.path)
  const surfaces = placed.filter((e) => e.surface).sort((a, b) => b.path.length - a.path.length)
  const containerOf = (e: DriftElement) => surfaces.find((s) => s !== e && isAncestor(s.path, e.path))?.path ?? ''
  const reported = new Set<string>()
  for (const d of placed) {
    const b = pairs.get(d)!
    // Above: the nearest element ending above this one, sharing its column, not its container or content.
    // Within the same box first, so a card's content is measured against the card, not the page.
    const box = containerOf(d)
    const ending = placed.filter((o) => o !== d && !related(o, d) && o.y + o.h <= d.y + 1)
    const nearest = (list: DriftElement[]) => list.sort((p, q) => q.y + q.h - (p.y + p.h))[0]
    const above = nearest(ending.filter((o) => containerOf(o) === box)) ??
      nearest(ending.filter((o) => overlaps(o.x, o.x + o.w, d.x, d.x + d.w)))
    if (above) {
      const ob = pairs.get(above)!
      const want = d.y - (above.y + above.h)
      const got = b.y - (ob.y + ob.h)
      if (want >= 0 && Math.abs(want - got) >= 4) {
        const key = `${above.path}>${d.path}`
        if (!reported.has(key)) {
          reported.add(key)
          add({
            kind: 'spacing', property: `above`, prefix: 'Space above', subject: name(d), design: px(want), build: px(got),
            fix: `Make the space between ${name(above)} and ${name(d)} ${px(want)} (now ${px(got)}).`, designPath: d.path, ...pin(b),
          })
        }
      }
    }
    // Left: only between surfaces and graphics, whose widths come from layout rather than text rendering.
    if (!(d.surface || GRAPHIC.has(d.tag))) continue
    const left = placed
      .filter((o) => o !== d && (o.surface || GRAPHIC.has(o.tag)) && !related(o, d) && o.x + o.w <= d.x + 1 && overlaps(o.y, o.y + o.h, d.y, d.y + d.h))
      .sort((p, q) => q.x + q.w - (p.x + p.w))[0]
    if (left) {
      const ob = pairs.get(left)!
      const want = d.x - (left.x + left.w)
      const got = b.x - (ob.x + ob.w)
      if (want >= 0 && Math.abs(want - got) >= 4) {
        add({
          kind: 'spacing', property: 'left', prefix: 'Gap left of', subject: name(d), design: px(want), build: px(got),
          fix: `Make the gap between ${name(left)} and ${name(d)} ${px(want)} (now ${px(got)}).`, designPath: d.path, ...pin(b),
        })
      }
    }
  }
}

interface Raw extends Omit<DriftItem, 'key' | 'label'> {
  property: string
  prefix: string
  subject: string
}
type Add = (item: Raw) => void

/** One item per kind of change: the same difference on three cards is one thing to fix. */
function mergeRepeats(raw: Raw[]): DriftItem[] {
  const groups = new Map<string, Raw[]>()
  for (const item of raw) {
    const repeatable = item.kind !== 'missing' && item.kind !== 'extra' && item.kind !== 'text'
    const id = repeatable ? `${item.kind}|${item.property}|${item.prefix}|${item.design}|${item.build}` : `${item.kind}|${item.designPath ?? item.buildPath}|${item.property}|${item.subject}`
    groups.set(id, [...(groups.get(id) ?? []), item])
  }
  return [...groups.values()].map((group) => {
    const first = group[0]!
    const subjects = [...new Set(group.map((item) => item.subject))]
    const subject = subjects.length === 1 ? subjects[0]! : subjects.length === 2 ? `${subjects[0]} and ${subjects[1]}` : `${subjects.slice(0, 2).join(', ')} and ${subjects.length - 2} more`
    const paths = group.map((item) => item.designPath ?? item.buildPath ?? '').sort()
    const { property, prefix, subject: _subject, ...rest } = first
    return {
      ...rest,
      key: `${first.kind}:${paths.join(',')}:${property}`,
      label: `${prefix} ${subject}`,
      fix: group.length > 1 ? `${first.fix.replace(/\.$/, '')} (in ${group.length} places).` : first.fix,
    }
  })
}

/** How to refer to an element: its text, or for a box, the text it holds. */
function describe(page: DriftPage, d: DriftElement) {
  if (d.text) return quote(d.text)
  const role = d.tag === 'button' || d.tag === 'a' ? d.tag : GRAPHIC.has(d.tag) ? (d.tag === 'svg' ? 'icon' : 'image') : FIELD.has(d.tag) ? 'field' : 'box'
  if (!d.surface) return `the ${role}`
  const inside = page.elements.filter((e) => e.text && isAncestor(d.path, e.path)).sort((a, b) => a.y - b.y || a.x - b.x)[0]
  return inside ? `the ${role} with ${quote(inside.text)}` : `the ${role}`
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
}

/** The differences still to fix: everything not accepted as intentional. */
export function openDrift(items: DriftItem[] | undefined, accepted: string[] | undefined) {
  const ok = new Set(accepted ?? [])
  return (items ?? []).filter((item) => !ok.has(item.key))
}

/** A request an agent can act on, listing the open differences with what to change. */
export function driftRequest(design: { id: string; name: string }, build: { id: string; name: string; buildUrl?: string }, items: DriftItem[]) {
  return [
    `The build of “${design.name}”${build.buildUrl ? ` at ${build.buildUrl}` : ''} differs from the approved design in ${items.length} ${items.length === 1 ? 'place' : 'places'}. Fix the code:`,
    '',
    ...items.map((item, i) => `${i + 1}. ${item.label}: ${item.fix}`),
    '',
    `Change the implementation in the codebase, not the design. Use the project's own components and theme tokens. Then call check_drift with build_frame_id ${build.id} to capture the page again, and repeat until no open differences are left. If a difference is intentional or the codebase can't match it exactly, say why.`,
  ].join('\n')
}
