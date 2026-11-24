/*
 * The bridge: a small script that runs inside a sketch's frame while it is on the board, so people can
 * pick and change elements. Sketches are sandboxed (no same-origin access), so everything goes through
 * postMessage. The script and its overlay are stripped whenever the HTML is saved.
 */

import { TOKEN_STYLE_ID } from '../tokens'

export const BRIDGE_ID = '__zeko_bridge'
export const STREAM_MARKER = '<!-- zeko:stream -->'

export interface LayerNode {
  path: string
  tag: string
  name: string
  kind: 'text' | 'image' | 'button' | 'link' | 'input' | 'box' | 'svg'
  children: LayerNode[]
}

export interface ElementInfo {
  path: string
  tag: string
  name: string
  /** set when the element holds only text, so it can be edited as a string */
  text: string | null
  rect: { x: number; y: number; w: number; h: number }
  style: {
    fontSize: string
    fontWeight: string
    fontFamily: string
    lineHeight: string
    letterSpacing: string
    textAlign: string
    color: string
    backgroundColor: string
    padding: string
    paddingTop: string
    paddingRight: string
    paddingBottom: string
    paddingLeft: string
    borderRadius: string
    borderWidth: string
    borderStyle: string
    borderColor: string
    opacity: string
    gap: string
    display: string
    position: string
    flexDirection: string
    alignItems: string
    justifyContent: string
    overflowX: string
    overflowY: string
    width: string
    height: string
  }
  src?: string
  href?: string
  /** in a prototype: the screen a click on it opens, or "back" */
  goto?: string
}

/** An element linked to another screen: data-zeko-goto holds a frame id, or "back". */
export interface Hotspot {
  path: string
  to: string
  x: number
  y: number
  w: number
  h: number
}

type Point = { x: number; y: number }

export type ToFrame =
  | { type: 'edit'; on: boolean }
  | { type: 'zoom'; zoom: number }
  | { type: 'select'; path: string | null }
  | { type: 'hover'; path: string | null }
  | { type: 'hover-point'; point: Point; zoom: number }
  | { type: 'hover-point'; point: null }
  | { type: 'pick-point'; point: Point; parent: boolean; zoom: number }
  | { type: 'save-component'; path: string; requestId: string }
  /** attrs: an empty value removes the attribute */
  | { type: 'apply'; path: string; text?: string; style?: Record<string, string>; attrs?: Record<string, string> }
  | { type: 'remove'; path: string }
  | { type: 'duplicate'; path: string }
  | { type: 'insert'; path: string; kind: 'text' | 'box' | 'button' | 'image' }
  | { type: 'move'; path: string; dir: -1 | 1 }

export type FromFrame =
  | { type: 'ready' }
  | { type: 'stream-fallback'; sections: string }
  | { type: 'tree'; tree: LayerNode[] }
  | { type: 'selected'; info: ElementInfo | null }
  | { type: 'component'; requestId: string; component: Omit<import('../types').SketchComponent, 'id'> | null }
  | { type: 'html'; html: string }
  | { type: 'escape' }
  | { type: 'history'; redo: boolean }
  /** elements that open another screen in a prototype, in the frame's own pixels */
  | { type: 'hotspots'; items: Hotspot[] }

/* The script below is plain browser JavaScript, kept dependency free. */
const SCRIPT = String.raw`(() => {
  const BRIDGE = '${BRIDGE_ID}', OVERLAY = '__zeko_overlay', TOKENS = '${TOKEN_STYLE_ID}'
  const SKIP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'HEAD'])
  let editing = false, selected = null, hovered = null, textEditing = null
  let streamedSections = ''
  let pointerPoint = null, pointerZoom = 1, pendingDraw = 0
  const post = (m) => parent.postMessage(Object.assign({ __zeko: 1 }, m), '*')
  const kids = (el) => [...el.children].filter((c) => !SKIP.has(c.tagName) && c.id !== BRIDGE && c.id !== OVERLAY)
  const pathOf = (el) => {
    const p = []
    while (el && el !== document.body) {
      const par = el.parentElement
      if (!par) return null
      p.unshift(kids(par).indexOf(el))
      el = par
    }
    return p.join('.')
  }
  const byPath = (p) => {
    let el = document.body
    if (!p) return el
    for (const i of p.split('.').map(Number)) { el = kids(el)[i]; if (!el) return null }
    return el
  }
  const onlyText = (el) => el.childNodes.length > 0 && [...el.childNodes].every((n) => n.nodeType === 3 || (n.nodeType === 1 && ['BR', 'B', 'I', 'EM', 'STRONG', 'SPAN', 'A'].includes(n.tagName) && n.children.length === 0))
  const kindOf = (el) => {
    const t = el.tagName
    if (t === 'IMG' || t === 'PICTURE' || t === 'VIDEO') return 'image'
    if (t === 'SVG' || t === 'svg') return 'svg'
    if (t === 'BUTTON') return 'button'
    if (t === 'A') return 'link'
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return 'input'
    if (onlyText(el) && el.textContent.trim()) return 'text'
    return 'box'
  }
  const nameOf = (el) => {
    if (el.id) return '#' + el.id
    const text = onlyText(el) ? [...el.childNodes].map((n) => n.textContent.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ') : ''
    if (text) return text.slice(0, 40)
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').slice(0, 40)
    if (el.classList.length) return '.' + [...el.classList].slice(0, 2).join('.')
    if (el.tagName === 'IMG') return el.getAttribute('alt') || 'image'
    return el.tagName.toLowerCase()
  }
  const tree = (el, path, depth) => kids(el).map((c, i) => {
    const p = path === '' ? String(i) : path + '.' + i
    return { path: p, tag: c.tagName.toLowerCase(), name: nameOf(c), kind: kindOf(c), children: depth < 14 && kindOf(c) === 'box' ? tree(c, p, depth + 1) : [] }
  })
  const info = (el) => {
    if (!el || el === document.body) return null
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
    return {
      path: pathOf(el), tag: el.tagName.toLowerCase(), name: nameOf(el),
      text: onlyText(el) ? el.innerText : null,
      rect: { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      style: {
        fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, textAlign: cs.textAlign,
        color: cs.color, backgroundColor: cs.backgroundColor, padding: cs.padding, borderRadius: cs.borderRadius, opacity: cs.opacity,
        paddingTop: cs.paddingTop, paddingRight: cs.paddingRight, paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
        borderWidth: cs.borderTopWidth, borderStyle: cs.borderTopStyle, borderColor: cs.borderTopColor,
        position: cs.position, flexDirection: cs.flexDirection, alignItems: cs.alignItems, justifyContent: cs.justifyContent,
        overflowX: cs.overflowX, overflowY: cs.overflowY,
        gap: cs.gap, display: cs.display, width: cs.width, height: cs.height,
      },
      src: el.getAttribute('src') || undefined, href: el.getAttribute('href') || undefined,
      goto: el.getAttribute('data-zeko-goto') || undefined,
    }
  }

  // Outlines drawn above the page, never part of it.
  const overlay = document.createElement('div')
  overlay.id = OVERLAY
  overlay.setAttribute('aria-hidden', 'true')
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
  const box = (stroke, color, fill) => {
    const d = document.createElement('div')
    d.style.cssText = 'position:fixed;display:none;box-sizing:border-box;box-shadow:inset 0 0 0 calc(' + stroke + 'px * var(--zeko-outline-scale,1)) ' + color + ';background:' + fill
    overlay.appendChild(d)
    return d
  }
  const hoverBox = box(1, '#ff3d61', 'rgba(255,61,97,.045)')
  const selBox = box(1.5, '#ff3d61', 'rgba(255,61,97,.07)')
  const tag = document.createElement('div')
  tag.style.cssText = 'position:fixed;display:none;z-index:1;transform-origin:top left;transform:scale(var(--zeko-outline-scale,1));box-sizing:border-box;background:#ff7893;color:#280916;font:600 10px/16px ui-monospace,monospace;padding:0 5px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
  overlay.appendChild(tag)
  const place = (d, el) => {
    if (!el || !el.isConnected) { d.style.display = 'none'; return }
    const r = el.getBoundingClientRect()
    Object.assign(d.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' })
    return r
  }
  const draw = () => {
    overlay.style.setProperty('--zeko-outline-scale', 1 / pointerZoom)
    const preview = pointerPoint ? elementAt(pointerPoint) : hovered
    const hoverRect = place(hoverBox, preview !== selected ? preview : null)
    const selectRect = place(selBox, editing ? selected : null)
    const target = hoverRect ? preview : selected
    const r = hoverRect || selectRect
    if (!r || !target || innerWidth * pointerZoom < 24 || innerHeight * pointerZoom < 18) {
      tag.style.display = 'none'
      return
    }
    tag.textContent = '<' + target.tagName.toLowerCase() + '>' +
      (hoverRect ? '' : ' ' + Math.round(r.width) + ' × ' + Math.round(r.height))
    tag.style.display = 'block'
    tag.style.maxWidth = innerWidth * pointerZoom + 'px'
    const labelWidth = tag.offsetWidth / pointerZoom
    const gap = 3 / pointerZoom
    const right = r.right + gap
    const beside = hoverRect && right + labelWidth <= innerWidth
    const left = beside ? right : Math.min(Math.max(0, r.left), Math.max(0, innerWidth - labelWidth))
    const above = r.top - 18 / pointerZoom
    const top = Math.min(Math.max(0, beside || above < 0 ? r.top : above), Math.max(0, innerHeight - 16 / pointerZoom))
    Object.assign(tag.style, { left: left + 'px', top: top + 'px' })
  }
  const scheduleDraw = () => {
    if (pendingDraw) return
    pendingDraw = requestAnimationFrame(() => { pendingDraw = 0; draw() })
  }
  const mount = () => { if (!overlay.isConnected) document.body.appendChild(overlay) }

  const serialize = () => {
    const root = document.documentElement.cloneNode(true)
    root.querySelectorAll('#' + BRIDGE + ', #' + OVERLAY + ', #' + TOKENS).forEach((n) => n.remove())
    root.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'))
    return '<!doctype html>\n' + root.outerHTML
  }
  const report = () => {
    post({ type: 'tree', tree: tree(document.body, '', 0) })
    post({ type: 'selected', info: info(selected) })
    draw()
  }
  // Saves are batched, so a color drag or a run of nudges becomes one save (and one undo step).
  let saveTimer = 0
  const commit = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => post({ type: 'html', html: serialize() }), 250); report() }

  const editableElement = (el) => {
    if (!el || el === document.body || el === document.documentElement || overlay.contains(el)) return null
    // SVG internals are represented by one layer in the tree.
    return el.closest('svg') || el
  }
  const elementAt = ({ x, y }) => editableElement(document.elementFromPoint(x, y))
  const parentOf = (el) => editableElement(el?.parentElement) || el
  const snapshotComponent = (el) => {
    const { width, height } = el.getBoundingClientRect()
    const embedded = 'script,style,iframe,object,embed,link'
    if (!width || !height || el.matches(embedded)) return null
    const clone = el.cloneNode(true)
    const original = [el, ...el.querySelectorAll('*')]
    const copies = [clone, ...clone.querySelectorAll('*')]
    for (let i = 0; i < original.length; i++) {
      const copy = copies[i]
      const style = getComputedStyle(original[i])
      for (const property of [
        'box-sizing', 'display', 'width', 'height', 'margin', 'padding', 'overflow', 'vertical-align',
        'position', 'inset', 'transform', 'gap', 'flex', 'flex-direction', 'flex-wrap', 'align-items',
        'justify-content', 'grid-template-columns', 'grid-template-rows', 'grid-area', 'object-fit',
        'font', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
        'text-align', 'text-decoration', 'white-space', 'color', 'background', 'border',
        'border-radius', 'box-shadow', 'opacity', 'fill', 'stroke', 'stroke-width',
      ]) {
        const value = style.getPropertyValue(property)
        if (value) copy.style?.setProperty(property, value)
      }
      for (const attr of [...copy.attributes]) {
        if (attr.name.startsWith('on') || ['contenteditable', 'autofocus', 'data-zeko-goto'].includes(attr.name)) copy.removeAttribute(attr.name)
      }
    }
    clone.querySelectorAll(embedded).forEach((node) => node.remove())
    clone.style.setProperty('position', 'relative')
    clone.style.removeProperty('inset')
    clone.style.removeProperty('margin')
    return {
      name: nameOf(el).slice(0, 120),
      tag: el.tagName.toLowerCase(),
      html: '<!doctype html><meta charset="utf-8"><style>body{margin:0;display:grid;place-items:center;min-height:100vh}</style><body>' + clone.outerHTML + '</body>',
      w: Math.max(160, Math.ceil(width)),
      h: Math.max(120, Math.ceil(height)),
    }
  }
  const pick = (el) => {
    selected = editableElement(el)
    if (editing) report()
  }
  const finishText = () => {
    if (!textEditing) return
    const el = textEditing
    textEditing = null
    el.removeAttribute('contenteditable')
    commit()
  }

  addEventListener('mousemove', (e) => {
    if (!editing) return
    hovered = editableElement(e.target)
    scheduleDraw()
  }, true)
  addEventListener('mouseleave', () => { hovered = null; scheduleDraw() })
  addEventListener('click', (e) => {
    if (!editing) return
    if (textEditing && textEditing.contains(e.target)) return
    e.preventDefault(); e.stopPropagation()
    finishText()
    // Alt-click picks the parent, so containers are easy to reach.
    const el = editableElement(e.target)
    pick(e.altKey ? parentOf(el) : el)
  }, true)
  addEventListener('dblclick', (e) => {
    if (!editing) return
    e.preventDefault(); e.stopPropagation()
    const el = e.target
    if (!onlyText(el) || !el.textContent.trim()) return
    pick(el)
    textEditing = el
    el.setAttribute('contenteditable', 'plaintext-only')
    el.focus()
    const range = document.createRange(); range.selectNodeContents(el)
    const s = getSelection(); s.removeAllRanges(); s.addRange(range)
  }, true)
  addEventListener('focusout', (e) => { if (textEditing && e.target === textEditing) finishText() })
  addEventListener('submit', (e) => { if (editing) e.preventDefault() }, true)
  addEventListener('keydown', (e) => {
    if (!editing) return
    const mod = e.metaKey || e.ctrlKey
    if (textEditing) {
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); textEditing.blur() }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); if (selected) pick(null); else post({ type: 'escape' }); return }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); post({ type: 'history', redo: e.shiftKey }); return }
    if (!selected) return
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); const p = selected.parentElement; selected.remove(); selected = p === document.body ? null : p; commit() }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); const c = selected.cloneNode(true); selected.after(c); selected = c; commit() }
    else if (e.key === 'Enter' && onlyText(selected)) { e.preventDefault(); selected.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) }
  }, true)
  addEventListener('scroll', scheduleDraw, true)
  addEventListener('resize', scheduleDraw)

  addEventListener('message', (e) => {
    const m = e.data
    if (e.source !== parent || !m || m.__zeko !== 2) return
    if (m.type === 'stream' && typeof m.sections === 'string') {
      if (m.sections === streamedSections) return
      try {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT)
        let marker
        while ((marker = walker.nextNode()) && marker.data.trim() !== 'zeko:stream') {}
        if (!marker || !m.sections.startsWith(streamedSections)) throw new Error('Sketch changed')
        const range = document.createRange()
        range.setStartBefore(marker)
        range.collapse(true)
        const fragment = range.createContextualFragment(m.sections.slice(streamedSections.length))
        const sections = [...fragment.children]
        marker.before(fragment)
        streamedSections = m.sections
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
          for (const section of sections) section.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' })
        }
        if (editing) report()
      } catch {
        post({ type: 'stream-fallback', sections: m.sections })
      }
      return
    }
    if (m.type === 'theme' && typeof m.css === 'string') {
      const existing = document.getElementById(TOKENS)
      if (!existing && !m.css) return
      const node = existing || document.createElement('style')
      node.id = TOKENS
      node.textContent = m.css
      if (!node.isConnected) document.head.append(node)
      if (editing) report()
      return
    }
    if (m.type === 'edit') {
      editing = m.on
      document.documentElement.style.cursor = editing ? 'default' : ''
      pointerPoint = null
      if (!editing) { finishText(); selected = null; hovered = null }
      mount(); report()
    } else if (m.type === 'zoom') {
      pointerZoom = m.zoom
      scheduleDraw()
    } else if (m.type === 'save-component') {
      const el = editing && editableElement(byPath(m.path))
      const component = el ? snapshotComponent(el) : null
      post({ type: 'component', requestId: m.requestId, component })
    } else if (m.type === 'select') { pick(m.path === null ? null : byPath(m.path)) }
    else if (m.type === 'hover') { hovered = m.path === null ? null : byPath(m.path); scheduleDraw() }
    else if (m.type === 'hover-point') {
      pointerPoint = editing ? null : m.point
      if (m.point) pointerZoom = m.zoom
      scheduleDraw()
    } else if (m.type === 'pick-point') {
      pointerZoom = m.zoom
      const el = elementAt(m.point)
      pick(m.parent ? parentOf(el) : el)
    }
    else {
      const el = byPath(m.path)
      if (!el) return
      if (m.type === 'apply') {
        if (typeof m.text === 'string') el.innerText = m.text
        if (m.style) for (const [k, v] of Object.entries(m.style)) el.style.setProperty(k, v)
        if (m.attrs) for (const [k, v] of Object.entries(m.attrs)) { if (v === '') el.removeAttribute(k); else el.setAttribute(k, v) }
        selected = el
      } else if (m.type === 'remove') { const p = el.parentElement; el.remove(); selected = p === document.body ? null : p }
      else if (m.type === 'duplicate') { const c = el.cloneNode(true); el.after(c); selected = c }
      else if (m.type === 'move') {
        const sib = m.dir < 0 ? el.previousElementSibling : el.nextElementSibling
        if (sib && sib.id !== OVERLAY && sib.id !== BRIDGE) { if (m.dir < 0) sib.before(el); else sib.after(el) }
        selected = el
      } else if (m.type === 'insert') {
        const parent = onlyText(el) || ['IMG', 'INPUT', 'BUTTON'].includes(el.tagName) ? el.parentElement : el
        const n = document.createElement(m.kind === 'text' ? 'p' : m.kind === 'button' ? 'button' : m.kind === 'image' ? 'img' : 'div')
        if (m.kind === 'text') n.textContent = 'New text'
        if (m.kind === 'button') { n.textContent = 'Button'; n.style.cssText = 'padding:10px 16px;border-radius:8px;border:0;background:#111;color:#fff;font:inherit;cursor:pointer' }
        if (m.kind === 'box') n.style.cssText = 'min-height:80px;padding:16px;border-radius:8px;background:rgba(0,0,0,.06)'
        if (m.kind === 'image') { n.setAttribute('alt', ''); n.setAttribute('src', 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="100%" height="100%" fill="#e5e7eb"/></svg>')); n.style.cssText = 'display:block;max-width:100%;height:auto;border-radius:8px' }
        if (parent === el) el.appendChild(n); else el.after(n)
        selected = n
      }
      commit()
    }
  })

  /* Prototype links: where each one sits, so the board can draw its arrow. */
  let lastSpots = ''
  const hotspots = () => {
    const items = [...document.querySelectorAll('[data-zeko-goto]')].map((el) => {
      const r = el.getBoundingClientRect()
      return { path: pathOf(el), to: el.getAttribute('data-zeko-goto'), x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }
    })
    const key = JSON.stringify(items)
    if (key !== lastSpots) { lastSpots = key; post({ type: 'hotspots', items }) }
  }
  addEventListener('resize', hotspots)
  addEventListener('load', hotspots)
  new MutationObserver((records) => {
    if (records.some(({ target }) => !overlay.contains(target))) hotspots()
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-zeko-goto', 'style', 'class'] })
  const ready = () => { mount(); post({ type: 'ready' }); hotspots() }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', ready); else ready()
})()`

/** The sketch as shown on the board: its own HTML plus the bridge. */
export function withBridge(html: string): string {
  const tag = `<script id="${BRIDGE_ID}">${SCRIPT}</script>`
  const i = html.toLowerCase().lastIndexOf('</body>')
  return i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i)
}

/* Which frame window is which, so messages can be routed. */
const windows = new Map<string, Window>()
const lastFromBridge = new Map<string, string>()

export function registerFrame(frameId: string, win: Window | null) {
  if (win) windows.set(frameId, win)
  else windows.delete(frameId)
}

export function frameIdOf(source: MessageEventSource | null): string | null {
  for (const [id, win] of windows) if (win === source) return id
  return null
}

export function sendToFrame(frameId: string, message: ToFrame) {
  windows.get(frameId)?.postMessage({ __zeko: 2, ...message }, '*')
}

/** Remember HTML the frame produced itself, so saving it doesn't reload the frame. */
export function noteBridgeHtml(frameId: string, html: string) {
  lastFromBridge.set(frameId, html)
}

export function cameFromBridge(frameId: string, html: string | undefined) {
  return html !== undefined && lastFromBridge.get(frameId) === html
}
