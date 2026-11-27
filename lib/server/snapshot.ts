import 'server-only'
import { withWebPage } from './render'
import { assertFetchable } from './safe-url'

/*
 * Snapshot: load a live page and turn what it shows into an editable sketch. Each element keeps the computed
 * styles that differ from its defaults, written inline, so the copy looks like the page without its stylesheets
 * or scripts. Web fonts come along through their @font-face rules.
 */

const MAX_HTML = 1_900_000

export interface Snapshot {
  html: string
  title: string
  height: number
}

/** Runs inside the captured page. Self-contained: it can't refer to anything outside itself. */
function captureDom(maxNodes: number) {
  const PROPS = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'clear', 'box-sizing',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'overflow-x', 'overflow-y', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
    'justify-content', 'align-items', 'align-self', 'align-content', 'row-gap', 'column-gap',
    'grid-template-columns', 'grid-template-rows', 'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end', 'grid-auto-flow',
    'color', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'background-clip',
    'opacity', 'box-shadow', 'transform', 'transform-origin', 'filter', 'backdrop-filter', 'mix-blend-mode', 'clip-path',
    'object-fit', 'object-position', 'aspect-ratio',
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform',
    'text-decoration-line', 'text-decoration-color', 'text-shadow', 'white-space', 'text-overflow', 'word-break', 'overflow-wrap',
    'list-style-type', 'vertical-align', 'visibility', 'fill', 'stroke', '-webkit-line-clamp', '-webkit-box-orient',
  ]
  const INHERITED = new Set([
    'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform',
    'white-space', 'word-break', 'overflow-wrap', 'list-style-type', 'visibility', 'text-shadow', 'fill', 'stroke',
  ])
  const SKIP = new Set(['script', 'noscript', 'template', 'style', 'link', 'meta', 'object', 'embed', 'base', 'title', 'head'])
  const REPLACED = new Set(['img', 'svg', 'video', 'canvas', 'input', 'select', 'textarea', 'button', 'iframe', 'picture'])
  const KEEP_ATTRS = new Set(['alt', 'title', 'role', 'type', 'placeholder', 'name', 'colspan', 'rowspan', 'aria-label', 'aria-hidden', 'for', 'disabled', 'checked', 'lang', 'dir'])

  const sandbox = document.createElement('iframe')
  sandbox.style.cssText = 'position:absolute;left:-9999px;width:800px;height:600px;border:0;visibility:hidden'
  document.documentElement.appendChild(sandbox)
  const sdoc = sandbox.contentDocument!
  sdoc.open()
  sdoc.write('<!doctype html><html><head></head><body></body></html>')
  sdoc.close()
  const defaults = new Map<string, Record<string, string>>()
  const defaultsFor = (tag: string, pseudo = false) => {
    const key = pseudo ? '::span' : tag
    let found = defaults.get(key)
    if (found) return found
    const probe = sdoc.createElement(pseudo ? 'span' : tag)
    // Links only get the browser's link color and underline with an href, as captured links have.
    if (tag === 'a' && !pseudo) probe.setAttribute('href', '#')
    sdoc.body.appendChild(probe)
    const cs = sandbox.contentWindow!.getComputedStyle(probe)
    found = Object.fromEntries(PROPS.map((p) => [p, cs.getPropertyValue(p)]))
    probe.remove()
    defaults.set(key, found)
    return found
  }

  const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const escapeAttr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  let nodes = 0

  const styleFor = (el: Element, cs: CSSStyleDeclaration, parent: CSSStyleDeclaration | null, tag: string, pseudo = false) => {
    const base = defaultsFor(tag, pseudo)
    const plain = defaultsFor('span', true)
    const parentDisplay = parent?.getPropertyValue('display') ?? ''
    const inFlexOrGrid = /flex|grid/.test(parentDisplay)
    const absolute = cs.position === 'absolute' || cs.position === 'fixed'
    const childless = !pseudo && !el.childNodes.length
    const inlineBlock = /inline-(block|flex|grid)/.test(cs.display)
    const keepWidth = pseudo || REPLACED.has(tag) || absolute || childless || inlineBlock || (inFlexOrGrid && cs.flexGrow === '0')
    const keepHeight = pseudo || REPLACED.has(tag) || absolute || childless
    const out: string[] = []
    // Equal side margins on a block narrower than its container were most likely written as auto: keep it centered at any width.
    const constrained = keepWidth || cs.maxWidth !== 'none'
    const centered = !absolute && constrained && !cs.display.startsWith('inline') && cs.marginLeft === cs.marginRight && parseFloat(cs.marginLeft) > 0
    for (const p of PROPS) {
      let v = cs.getPropertyValue(p)
      if (!v) continue
      if (centered && (p === 'margin-left' || p === 'margin-right')) v = 'auto'
      if ((p === 'width' || p === 'height') && !(p === 'width' ? keepWidth : keepHeight)) continue
      // A border with a style needs its width spelled out, or it falls back to the browser's 3px.
      const side = /^border-(\w+)-width$/.exec(p)?.[1]
      if (side && cs.getPropertyValue(`border-${side}-style`) !== 'none') {
        out.push(`${p}:${v}`)
        continue
      }
      // Inherited values can be left to the parent, unless the browser gives this tag its own (link colors, heading weights).
      if (INHERITED.has(p) ? parent && parent.getPropertyValue(p) === v && base[p] === plain[p] : base[p] === v) continue
      out.push(`${p}:${v.replace(/"/g, "'")}`)
    }
    return out.join(';')
  }

  const pseudoHtml = (el: Element, cs: CSSStyleDeclaration, which: '::before' | '::after') => {
    const ps = getComputedStyle(el, which)
    const content = ps.content
    if (!content || content === 'none' || content === 'normal') return ''
    const text = /^["'](.*)["']$/.exec(content)?.[1] ?? ''
    const style = styleFor(el, ps, cs, 'span', true)
    if (!text && !style.includes('background') && !style.includes('border')) return ''
    return `<span aria-hidden="true" style="${escapeAttr(style)}">${escapeText(text)}</span>`
  }

  const visit = (node: Node, parent: CSSStyleDeclaration | null): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent ?? '')
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as Element
    const tag = el.localName
    if (SKIP.has(tag) || el === sandbox) return ''
    if (++nodes > maxNodes) return ''
    const cs = getComputedStyle(el)
    if (cs.display === 'none') return ''
    const rect = el.getBoundingClientRect()
    if (tag === 'svg') {
      const clone = el.cloneNode(true) as SVGElement
      clone.querySelectorAll('script, foreignObject').forEach((n) => n.remove())
      clone.setAttribute('style', `${styleFor(el, cs, parent, 'span')};width:${rect.width}px;height:${rect.height}px`)
      return clone.outerHTML
    }
    if (tag === 'iframe' || tag === 'video' || tag === 'canvas') {
      let src = ''
      if (tag === 'canvas') try { src = (el as HTMLCanvasElement).toDataURL('image/webp', 0.85) } catch { src = '' }
      if (tag === 'video') src = (el as HTMLVideoElement).poster
      const box = `display:${cs.display === 'inline' ? 'inline-block' : cs.display};width:${rect.width}px;height:${rect.height}px;border-radius:${cs.borderRadius}`
      return src
        ? `<img src="${escapeAttr(src)}" alt="" style="${box};object-fit:cover">`
        : `<div aria-hidden="true" style="${box};background:#e5e7eb"></div>`
    }
    const attrs: string[] = []
    for (const attr of Array.from(el.attributes)) {
      if (KEEP_ATTRS.has(attr.name) || attr.name.startsWith('aria-')) attrs.push(`${attr.name}="${escapeAttr(attr.value)}"`)
    }
    if (tag === 'a' && (el as HTMLAnchorElement).href) attrs.push(`href="${escapeAttr((el as HTMLAnchorElement).href)}"`)
    if (tag === 'img') {
      const src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src
      if (src) attrs.push(`src="${escapeAttr(src)}"`)
    }
    if (tag === 'input' && (el as HTMLInputElement).value) attrs.push(`value="${escapeAttr((el as HTMLInputElement).value)}"`)
    const style = styleFor(el, cs, parent, tag)
    if (style) attrs.push(`style="${escapeAttr(style)}"`)
    const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`
    if (['img', 'input', 'br', 'hr', 'wbr', 'area', 'source', 'track', 'col'].includes(tag)) return open
    if (tag === 'textarea') return `${open}${escapeText((el as HTMLTextAreaElement).value)}</textarea>`
    let inner = pseudoHtml(el, cs, '::before')
    for (const child of Array.from(el.childNodes)) inner += visit(child, cs)
    inner += pseudoHtml(el, cs, '::after')
    return `${open}${inner}</${tag}>`
  }

  const rootStyle = getComputedStyle(document.documentElement)
  const bodyStyle = getComputedStyle(document.body)
  let body = ''
  for (const child of Array.from(document.body.childNodes)) body += visit(child, bodyStyle)
  const background = bodyStyle.backgroundColor === 'rgba(0, 0, 0, 0)' ? rootStyle.backgroundColor : bodyStyle.backgroundColor
  // The body keeps its own layout (max-width, padding, centering, text alignment) and the page background,
  // with inherited properties compared to defaults so the whole page's type carries over.
  const own = styleFor(document.body, bodyStyle, null, 'body')
    .split(';').filter((d) => d && !d.startsWith('background-color'))
  const bodyCss = [`background-color:${background}`, `color:${bodyStyle.color}`, ...own].join(';')
  sandbox.remove()
  return {
    body: `<body style="${escapeAttr(bodyCss)}">${body}</body>`,
    title: document.title,
    height: Math.ceil(document.documentElement.scrollHeight),
    truncated: nodes > maxNodes,
  }
}

const FONT_FACE = /@font-face\s*\{[^}]*\}/gi

function absoluteUrls(css: string, base: string) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, quote: string, href: string) => {
    if (/^data:/i.test(href)) return whole
    try {
      return `url("${new URL(href, base).href}")`
    } catch {
      return whole
    }
  })
}

export async function snapshotPage(address: string, width: number, height: number): Promise<Snapshot> {
  const url = await assertFetchable(address)
  const guard = (target: string) => assertFetchable(target).then(() => true, () => false)
  return withWebPage(guard, async (page) => {
    const pending: Promise<string>[] = []
    page.on('response', (response) => {
      const type = response.headers()['content-type'] ?? ''
      if (!type.includes('text/css')) return
      pending.push(response.text().then((css) => (css.match(FONT_FACE) ?? []).map((rule) => absoluteUrls(rule, response.url())).join('\n'), () => ''))
    })
    await page.setViewport({ width: Math.round(width), height: Math.round(height) })
    const response = await page.goto(url.href, { waitUntil: 'networkidle2', timeout: 25_000 }).catch(() => null)
    if (!response && page.url() === 'about:blank') throw new Error('That page didn’t load.')
    if (response && response.status() >= 400) throw new Error(`That page answered ${response.status()}.`)
    // Scroll through once so lazy images and reveal-on-scroll content are in place.
    await page.evaluate(async () => {
      const total = Math.min(document.documentElement.scrollHeight, 16_000)
      for (let y = 0; y < total; y += innerHeight * 0.8) {
        window.scrollTo(0, y)
        await new Promise((resolve) => setTimeout(resolve, 120))
      }
      window.scrollTo(0, 0)
      await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1500))])
    }).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 400))
    // @font-face rules written in the page's own <style> elements, not loaded from stylesheets.
    const inlineFaces = await page.evaluate(() => Array.from(document.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n')).catch(() => '')
    const captured = await page.evaluate(captureDom, 6000)
    const faces = [...new Set([...(await Promise.all(pending)), ...(inlineFaces.match(FONT_FACE) ?? []).map((rule) => absoluteUrls(rule, url.href))])].filter(Boolean).join('\n')
    const title = captured.title.trim().slice(0, 100) || url.hostname
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title.replace(/</g, '&lt;')}</title>${faces ? `<style>${faces}</style>` : ''}</head>${captured.body}</html>`
    if (html.length > MAX_HTML) throw new Error('That page is too large to snapshot whole. Try a narrower frame or a simpler page.')
    return { html, title, height: Math.min(8000, captured.height) }
  })
}
