/*
 * Components and their instances. A component's main copy is a standalone document; each instance is an element
 * in a sketch whose root carries data-zeko-instance="<component id>". Changing the main copy rewrites every
 * instance. This works on HTML strings, so the same code runs in the browser, on the server and in the reducer.
 */

export const INSTANCE_ATTR = 'data-zeko-instance'

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const RAW = new Set(['script', 'style', 'textarea', 'title'])
// A start tag, an end tag or a comment. Attribute values may contain ">", so quoted values are matched whole.
const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g

interface Range { start: number; end: number; tag: string; attrs: string }

/** Every top-level element in the HTML whose start tag satisfies the test, with its extent. */
export function findElements(html: string, test: (tag: string, attrs: string) => boolean): Range[] {
  const found: Range[] = []
  TAG.lastIndex = 0
  let open: { tag: string; depth: number; start: number; attrs: string } | null = null
  let match: RegExpExecArray | null
  while ((match = TAG.exec(html))) {
    const [whole, closing, rawName, attrs = '', selfClosing] = match
    if (!rawName) continue
    const tag = rawName.toLowerCase()
    if (!closing && RAW.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, TAG.lastIndex)
      if (end < 0) break
      TAG.lastIndex = end
      continue
    }
    if (open) {
      if (tag !== open.tag) continue
      if (closing) open.depth--
      else if (!selfClosing) open.depth++
      if (open.depth === 0) {
        found.push({ start: open.start, end: match.index + whole.length, tag, attrs: open.attrs })
        open = null
      }
      continue
    }
    if (closing || !test(tag, attrs)) continue
    if (VOID.has(tag) || selfClosing) found.push({ start: match.index, end: match.index + whole.length, tag, attrs })
    else open = { tag, depth: 1, start: match.index, attrs }
  }
  return found
}

const attrValue = (attrs: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i').exec(attrs)
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null
}

export const instanceRanges = (html: string, id: string) => findElements(html, (_, attrs) => attrValue(attrs, INSTANCE_ATTR) === id)

export const countInstances = (html: string | undefined, id: string) => (html && html.includes(id) ? instanceRanges(html, id).length : 0)

/** Rewrites every instance of a component in a document. Returns the same string when there are none. */
export function replaceInstances(html: string, id: string, body: string): string {
  if (!html.includes(id)) return html
  const ranges = instanceRanges(html, id)
  if (!ranges.length) return html
  let out = ''
  let at = 0
  for (const range of ranges) {
    out += html.slice(at, range.start) + body
    at = range.end
  }
  return out + html.slice(at)
}

/** Sets an attribute on the first start tag of an element's HTML. */
export function withRootAttribute(element: string, name: string, value: string): string {
  const m = /^(\s*<[a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)(\s*\/?>)/.exec(element)
  if (!m) return element
  const escaped = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  const attrs = m[2]!.replace(new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'=<>\`]+)`, 'gi'), '')
  return `${m[1]}${attrs} ${name}="${escaped}"${m[3]}${element.slice(m[0].length)}`
}

/** The first element inside <body> of a component's main document: what each instance becomes. */
export function componentBody(documentHtml: string, id: string): string | null {
  const body = /<body\b[^>]*>/i.exec(documentHtml)
  const from = body ? body.index + body[0].length : 0
  const rest = documentHtml.slice(from)
  const [first] = findElements(rest, (tag) => !RAW.has(tag) && !['link', 'meta', 'noscript', 'template'].includes(tag))
  if (!first) return null
  return withRootAttribute(rest.slice(first.start, first.end), INSTANCE_ATTR, id)
}

export function componentDocument(body: string): string {
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0;display:grid;place-items:center;min-height:100vh}</style><body>${body}</body>`
}
