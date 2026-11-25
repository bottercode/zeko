import 'server-only'
import { createHash } from 'node:crypto'
import { LAYER_IGNORED_IDS, LAYER_IGNORED_TAGS } from '../sketch-layers'
import { withSketchPage } from './render'

type Placement = { parent_path?: string; before_path?: string }

interface LayerInfo {
  path: string
  tag: string
  name: string
  text?: string
  box: number[]
  child_count: number
  style?: string
  computed_styles?: Record<string, string>
  children?: LayerInfo[]
}

export type LayerEdit =
  | { op: 'update'; path: string; text?: string; styles?: Record<string, string | null> }
  | ({ op: 'insert'; html: string } & Placement)
  | ({ op: 'move'; path: string } & Placement)
  | { op: 'replace'; path: string; html: string }
  | { op: 'remove'; path: string }

export function layerRevision(html: string) {
  return createHash('sha256').update(html).digest('hex')
}

/** Read the authored document at the frame's viewport, without executing the sketch's scripts. */
export function inspectLayers(html: string, frame: { w: number; h: number }, depth: number, path: string | undefined) {
  return withSketchPage(async (page) => {
    await page.setViewport({ width: Math.round(frame.w), height: Math.round(frame.h) })
    await page.setJavaScriptEnabled(false)
    await page.setRequestInterception(true)
    page.on('request', (request) => {
      void (request.isNavigationRequest() ? request.abort() : request.continue()).catch(() => undefined)
    })
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 5000 })
    return page.evaluate((ignoredTags, ignoredIds, depth, path) => {
      const children = (node: Element) => Array.from(node.children).filter((child) => !ignoredTags.includes(child.localName) && !ignoredIds.includes(child.id))
      const selected = path?.split('.').reduce<Element | undefined>((node, index) => node && children(node)[Number(index)], document.body)
      if (path !== undefined && !selected) throw new Error(`Layer ${path} was not found.`)
      const properties = [
        'display', 'position', 'width', 'height', 'padding', 'margin', 'gap', 'flex-direction', 'flex-wrap', 'align-items',
        'justify-content', 'grid-template-columns', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
        'text-align', 'color', 'background-color', 'border-radius', 'border-width', 'border-color', 'opacity', 'overflow',
      ]
      let count = 0
      let truncated = false

      function visit(node: Element, nodePath: string, levels: number): LayerInfo | undefined {
        if (count >= 200) { truncated = true; return }
        count++
        const kids = children(node)
        const text = Array.from(node.childNodes).filter((child) => child.nodeType === 3).map((child) => child.textContent).join(' ').trim().replace(/\s+/g, ' ')
        const rect = node.getBoundingClientRect()
        const classes = Array.from(node.classList).slice(0, 2)
        const named = node.id ? `#${node.id}` : text || node.getAttribute('aria-label') || (classes.length ? `.${classes.join('.')}` : node.getAttribute('alt') || node.localName)
        const details = node === selected ? getComputedStyle(node) : undefined
        return {
          path: nodePath,
          tag: node.localName,
          name: named.slice(0, 120),
          text: text.slice(0, 500) || undefined,
          box: [rect.x, rect.y, rect.width, rect.height].map(Math.round),
          child_count: kids.length,
          style: details ? node.getAttribute('style')?.slice(0, 6000) : undefined,
          computed_styles: details ? Object.fromEntries(properties.map((key) => [key, details.getPropertyValue(key)])) : undefined,
          children: levels > 1 && kids.length ? visitChildren(kids, `${nodePath}.`, levels - 1) : undefined,
        }
      }

      function visitChildren(nodes: Element[], prefix: string, levels: number) {
        const output = []
        for (const [index, node] of nodes.entries()) {
          const layer = visit(node, prefix + index, levels)
          if (!layer) break
          output.push(layer)
        }
        return output
      }

      const layers = selected ? [visit(selected, path!, depth)!] : visitChildren(children(document.body), '', depth)
      return { layers, truncated }
    }, LAYER_IGNORED_TAGS, LAYER_IGNORED_IDS, depth, path)
  })
}

/** Apply a whole batch to detached HTML, so no intermediate state can reach the canvas. */
export function editLayers(html: string, edits: LayerEdit[]) {
  return withSketchPage(async (page) => {
    await page.setOfflineMode(true)
    return page.evaluate((source, edits, ignoredTags, ignoredIds) => {
      const doc = new DOMParser().parseFromString(source, 'text/html')
      const body = doc.body
      const root = doc.documentElement
      const original = root.outerHTML
      const editable = (node: Element) => !ignoredTags.includes(node.localName) && !ignoredIds.includes(node.id)
      const children = (node: ParentNode) => Array.from(node.children).filter(editable)
      const isVoid = (node: Element) => node.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
        ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'].includes(node.localName)
      const lookup = (path: string) => {
        const found = path.split('.').reduce<Element | undefined>((node, index) => node && children(node)[Number(index)], body)
        if (!found) throw new Error(`Layer ${path} was not found.`)
        return found
      }

      // Resolve every path against the supplied revision, before any move or insert shifts it.
      const batch = edits.map((edit) => ({
        edit,
        target: 'path' in edit ? lookup(edit.path) : undefined,
        parent: 'parent_path' in edit && edit.parent_path !== undefined ? lookup(edit.parent_path) : body,
        before: 'before_path' in edit && edit.before_path !== undefined ? lookup(edit.before_path) : undefined,
      }))
      const changed = new Set<Element>()
      const insert = (parent: Element, anchor: Element | undefined, html: string) => {
        const range = doc.createRange()
        range.selectNodeContents(parent)
        const fragment = range.createContextualFragment(html)
        const layers = children(fragment)
        if (!layers.length) throw new Error('Layer HTML must include an element.')
        parent.insertBefore(fragment, anchor ?? null)
        layers.forEach((layer) => changed.add(layer))
      }

      for (const { edit, target, parent, before } of batch) {
        if (target && !body.contains(target)) throw new Error('A preceding edit removed the target layer.')
        if (!body.contains(parent) || (before && before.parentElement !== parent)) {
          throw new Error('The destination or its anchor is unavailable. The anchor must belong to the destination parent.')
        }
        if ((edit.op === 'insert' || edit.op === 'move') && isVoid(parent)) throw new Error('This layer cannot contain children.')
        switch (edit.op) {
          case 'insert':
            insert(parent, before, edit.html)
            break
          case 'replace':
            insert(target!.parentElement!, target, edit.html)
            target!.remove()
            break
          case 'remove':
            target!.remove()
            break
          case 'move':
            if (target!.contains(parent)) throw new Error('A layer cannot be moved into itself or its descendants.')
            parent.insertBefore(target!, before ?? null)
            changed.add(target!)
            break
          case 'update': {
            const node = target!
            if (edit.text !== undefined) {
              if (isVoid(node)) throw new Error('This layer cannot contain text.')
              const textNodes = Array.from(node.childNodes).filter((child) => child.nodeType === 3)
              const populated = textNodes.filter((child) => child.textContent?.trim())
              if (node.children.length && populated.length !== 1) {
                throw new Error('Select a text layer or replace this layer’s HTML to edit multiple text spans.')
              }
              if (node.children.length) {
                const text = populated[0]!.textContent!
                populated[0]!.textContent = text.replace(/\S[\s\S]*\S|\S/, () => edit.text!)
              } else {
                const first = textNodes[0]
                if (first) first.textContent = edit.text
                else node.prepend(doc.createTextNode(edit.text))
                textNodes.slice(1).forEach((child) => child.parentNode?.removeChild(child))
              }
            }
            if (edit.styles) {
              const style = (node as HTMLElement | SVGElement).style
              if (!style) throw new Error('This layer does not support inline CSS.')
              for (const [key, value] of Object.entries(edit.styles)) {
                if (value === null) style.removeProperty(key)
                else {
                  const cssValue = value.replace(/\s*!important\s*$/i, '')
                  if (!CSS.supports(key, cssValue)) throw new Error(`Invalid CSS value for ${key}. Use null to clear an inline property.`)
                  style.setProperty(key, cssValue, cssValue !== value ? 'important' : '')
                }
              }
              if (!style.length) node.removeAttribute('style')
            }
            changed.add(node)
            break
          }
        }
      }

      const paths = [...changed].filter((node) => body.contains(node)).map((node) => {
        const segments: number[] = []
        while (node !== body) {
          const parent = node.parentElement!
          segments.push(children(parent).indexOf(node))
          node = parent
        }
        return segments.reverse().join('.')
      })
      if (root.outerHTML === original) return { html: source, paths }
      const serializer = new XMLSerializer()
      const next = Array.from(doc.childNodes).map((node) => node === root ? root.outerHTML : serializer.serializeToString(node)).join('\n')
      if (new DOMParser().parseFromString(next, 'text/html').documentElement.outerHTML !== root.outerHTML) {
        throw new Error('This HTML changes structure when parsed. Check that each layer can go inside its destination.')
      }
      return { html: next, paths }
    }, html, edits, LAYER_IGNORED_TAGS, LAYER_IGNORED_IDS)
  })
}
