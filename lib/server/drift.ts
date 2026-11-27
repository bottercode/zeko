import 'server-only'
import { nanoid } from 'nanoid'
import { compareLayouts, type DriftElement, type DriftPage } from '../drift'
import { LAYER_IGNORED_IDS, LAYER_IGNORED_TAGS } from '../sketch-layers'
import { tokenValue, withDesignTokens } from '../tokens'
import type { Board, BoardDesign, DriftReport, Frame, Op } from '../types'
import { withSketchPage } from './render'
import { snapshotPage } from './snapshot'

const MAX_ELEMENTS = 4000

/** Renders a document at the given width with scripts off and measures every visible element. */
export async function measurePage(html: string, width: number, height: number, tokenNames: string[] = []): Promise<{ page: DriftPage; tokens: Record<string, string> }> {
  return withSketchPage(async (page) => {
    await page.setJavaScriptEnabled(false)
    await page.setViewport({ width: Math.round(width), height: Math.round(height) })
    await page.setContent(html, { waitUntil: 'load', timeout: 10_000 }).catch(() => undefined)
    return page.evaluate((ignoredTags: string[], ignoredIds: string[], tokenNames: string[], max: number) => {
      const elements: DriftElement[] = []
      const textOwners = new Set<Element>()
      const ownText = (el: Element) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim()
      const children = (node: Element) => Array.from(node.children).filter((c) => !ignoredTags.includes(c.localName) && !ignoredIds.includes(c.id))
      const visibleColor = (value: string) => !/rgba\([^)]*,\s*0\)$/.test(value) && value !== 'transparent'

      const visit = (el: Element, path: string, inText: boolean, inPinned: boolean) => {
        if (elements.length >= max) return
        const cs = getComputedStyle(el)
        if (cs.display === 'none') return
        const inline = cs.display.startsWith('inline') && !['img', 'svg', 'canvas', 'video', 'input', 'select', 'textarea', 'button'].includes(el.localName)
        // Inline children of a text block (bold words, links in a sentence) belong to that block's text.
        const partOfText = inText && inline
        const direct = partOfText ? '' : ownText(el)
        const text = direct ? (el as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() || direct : ''
        let rect = el.getBoundingClientRect()
        if (text) {
          const range = document.createRange()
          range.selectNodeContents(el)
          const r = range.getBoundingClientRect()
          if (r.width > 0 && r.height > 0) rect = r
        }
        const borderWidth = parseFloat(cs.borderTopWidth) || 0
        const pinned = inPinned || cs.position === 'fixed' || cs.position === 'sticky'
        const surface = !partOfText && !text && (
          visibleColor(cs.backgroundColor) || cs.backgroundImage !== 'none' ||
          (borderWidth > 0 && cs.borderTopStyle !== 'none' && visibleColor(cs.borderTopColor)) || cs.boxShadow !== 'none'
        )
        const media = ['img', 'svg', 'canvas', 'video', 'picture', 'input', 'select', 'textarea'].includes(el.localName)
        if (cs.visibility !== 'hidden' && rect.width >= 1 && rect.height >= 1 && (text || surface || media)) {
          elements.push({
            path, tag: el.localName, text,
            x: rect.left + scrollX, y: rect.top + scrollY, w: rect.width, h: rect.height,
            color: cs.color, background: cs.backgroundColor, borderColor: cs.borderTopColor, borderWidth,
            radius: parseFloat(cs.borderTopLeftRadius) || 0,
            fontFamily: cs.fontFamily, fontSize: parseFloat(cs.fontSize) || 0, fontWeight: Number(cs.fontWeight) || 400,
            surface: surface || (el.localName === 'button' && !text), pinned,
          })
          if (text) textOwners.add(el)
        }
        if (el.localName === 'svg') return
        children(el).forEach((child, i) => visit(child, path ? `${path}.${i}` : String(i), !!text || partOfText, pinned))
      }
      children(document.body).forEach((child, i) => visit(child, String(i), false, false))

      const tokens: Record<string, string> = {}
      for (const name of tokenNames) {
        const probe = document.createElement('div')
        probe.style.color = `var(--${name})`
        document.body.appendChild(probe)
        const value = getComputedStyle(probe).color
        probe.remove()
        if (value && visibleColor(value)) tokens[name] = value
      }
      const root = document.documentElement
      return {
        page: { width: root.clientWidth, height: Math.max(root.scrollHeight, document.body.scrollHeight), elements },
        tokens,
      }
    }, LAYER_IGNORED_TAGS, LAYER_IGNORED_IDS, tokenNames, MAX_ELEMENTS)
  })
}

/** Compares a build with its design, both rendered at the design's width. */
export async function checkDrift(design: Pick<Frame, 'html' | 'w' | 'h' | 'updatedAt'>, buildHtml: string, settings: BoardDesign | undefined): Promise<DriftReport> {
  const colorTokens = (settings?.tokens ?? []).filter((token) => token.kind === 'color').map((token) => token.name)
  const [designPage, buildPage] = await Promise.all([
    measurePage(withDesignTokens(design.html ?? '', settings), design.w, design.h, colorTokens),
    measurePage(buildHtml, design.w, design.h),
  ])
  // A token only counts when its value is a real color in the active theme.
  const tokens = Object.fromEntries(Object.entries(designPage.tokens).filter(([name]) => {
    const token = settings?.tokens.find((t) => t.name === name)
    return !!token && !!tokenValue(token, settings?.themeId ?? 'default')
  }))
  const { items, matched } = compareLayouts(designPage.page, buildPage.page, { tokens })
  return { checkedAt: Date.now(), designAt: design.updatedAt, matched, items }
}

export interface BuildCapture {
  /** the canvas as it is now */
  board: () => Board
  apply: (op: Op) => void
}

/**
 * Captures the implemented page for a design frame and checks it for drift. With url, the page is captured into
 * a new build frame beside the design (or into buildId); without, buildId is captured again from its address.
 */
export async function captureBuild(canvas: BuildCapture, input: { designId?: string; buildId?: string; url?: string; name?: string; recapture?: boolean }) {
  let board = canvas.board()
  const existing = input.buildId ? board.frames.find((f) => f.id === input.buildId) : undefined
  if (input.buildId && !existing) throw new Error('That build frame is gone.')
  const designId = input.designId ?? existing?.buildOf
  const design = board.frames.find((f) => f.id === designId)
  if (!design || design.kind !== 'sketch' || design.html === undefined) throw new Error('Choose the design sketch this page builds.')
  if (design.buildOf) throw new Error('That frame is itself a build. Choose the design it builds.')
  const url = input.url?.trim() || (input.recapture === false ? undefined : existing?.buildUrl)

  let buildId = existing?.id
  if (url) {
    const shot = await snapshotPage(url, design.w, design.h)
    const h = Math.min(8000, Math.max(design.h, shot.height))
    if (existing) {
      canvas.apply({ type: 'frame.update', id: existing.id, patch: { html: shot.html, h, buildUrl: url, buildOf: design.id } })
    } else {
      const builds = board.frames.filter((f) => f.buildOf === design.id)
      const below = builds.sort((a, b) => b.y + b.h - (a.y + a.h))[0]
      buildId = nanoid(10)
      canvas.apply({ type: 'frame.create', frame: {
        id: buildId, pageId: design.pageId, kind: 'sketch', name: input.name?.trim() || `${design.name} (build)`,
        html: shot.html, w: design.w, h, x: below ? below.x : design.x + design.w + 120, y: below ? below.y + below.h + 120 : design.y,
        route: design.route, state: design.state, buildOf: design.id, buildUrl: url,
      } })
    }
  } else if (!existing) {
    throw new Error('Enter the address where the build runs, such as http://localhost:3000/pricing.')
  } else if (existing.buildOf !== design.id) {
    canvas.apply({ type: 'frame.update', id: existing.id, patch: { buildOf: design.id } })
  }

  board = canvas.board()
  const build = board.frames.find((f) => f.id === buildId)!
  if (build.html === undefined) throw new Error('That build frame has no page to compare.')
  const freshDesign = board.frames.find((f) => f.id === design.id)!
  const drift = await checkDrift(freshDesign, build.html, board.design)
  canvas.apply({ type: 'frame.update', id: build.id, patch: { drift } })
  return { build: canvas.board().frames.find((f) => f.id === build.id)!, design: freshDesign, drift }
}
