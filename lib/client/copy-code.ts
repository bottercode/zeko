import { LAYER_IGNORED_IDS, LAYER_IGNORED_TAGS } from '../sketch-layers'
import { htmlToJsx, styleToCss } from '../html-to-jsx'
export { frameCode, type CodeFormat } from '../code'

/** The saved HTML of one layer, found by its layer path. */
export function layerHtml(documentHtml: string, path: string): Element | null {
  const doc = new DOMParser().parseFromString(documentHtml, 'text/html')
  const kids = (node: Element) => Array.from(node.children).filter((child) => !LAYER_IGNORED_TAGS.includes(child.localName) && !LAYER_IGNORED_IDS.includes(child.id))
  return path.split('.').reduce<Element | null>((node, index) => (node ? kids(node)[Number(index)] ?? null : null), doc.body)
}

export function elementCode(documentHtml: string, path: string, format: 'html' | 'react' | 'css'): string | null {
  const el = layerHtml(documentHtml, path)
  if (!el) return null
  if (format === 'css') return styleToCss(el.getAttribute('style') ?? '', el.id ? `#${el.id}` : el.classList[0] ? `.${el.classList[0]}` : el.localName)
  return format === 'react' ? htmlToJsx(el.outerHTML) : el.outerHTML
}

export async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text)
}
