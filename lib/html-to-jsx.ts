/*
 * Turns sketch HTML into a React component. String based, so it runs in the browser and on the server alike.
 * Event handler attributes and scripts are dropped: sketches are designs, and their behavior belongs to the app.
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const TOKEN = /<!--([\s\S]*?)-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/gi
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

const RENAMED: Record<string, string> = {
  class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength', minlength: 'minLength',
  colspan: 'colSpan', rowspan: 'rowSpan', autocomplete: 'autoComplete', autofocus: 'autoFocus', crossorigin: 'crossOrigin',
  srcset: 'srcSet', contenteditable: 'contentEditable', spellcheck: 'spellCheck', enctype: 'encType', novalidate: 'noValidate',
  frameborder: 'frameBorder', allowfullscreen: 'allowFullScreen', usemap: 'useMap', datetime: 'dateTime', charset: 'charSet',
  'http-equiv': 'httpEquiv', 'accept-charset': 'acceptCharset', inputmode: 'inputMode', enterkeyhint: 'enterKeyHint',
  viewbox: 'viewBox', 'xlink:href': 'xlinkHref', 'xml:space': 'xmlSpace', 'xmlns:xlink': 'xmlnsXlink', playsinline: 'playsInline',
  referrerpolicy: 'referrerPolicy', fetchpriority: 'fetchPriority', popovertarget: 'popoverTarget', formaction: 'formAction',
  preserveaspectratio: 'preserveAspectRatio', gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform',
  patternunits: 'patternUnits', stddeviation: 'stdDeviation', textlength: 'textLength', pathlength: 'pathLength',
}

const camel = (name: string) => name.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase())

const decode = (value: string) => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

function jsxName(name: string) {
  const lower = name.toLowerCase()
  if (RENAMED[lower]) return RENAMED[lower]
  if (lower.startsWith('data-') || lower.startsWith('aria-')) return lower
  return lower.includes('-') || lower.includes(':') ? camel(lower.replace(':', '-')) : name
}

/** Splits a declaration list on semicolons that are not inside parentheses or quotes. */
function declarations(style: string): [string, string][] {
  const out: [string, string][] = []
  let depth = 0
  let quote = ''
  let current = ''
  for (const ch of style) {
    if (quote) { if (ch === quote) quote = ''; current += ch; continue }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ';' && depth === 0) { push(); continue }
    current += ch
  }
  push()
  return out
  function push() {
    const at = current.indexOf(':')
    if (at > 0) {
      const property = current.slice(0, at).trim()
      const value = current.slice(at + 1).trim()
      if (property && value) out.push([property, value])
    }
    current = ''
  }
}

export function styleObject(style: string): string {
  const entries = declarations(decode(style)).map(([property, value]) => {
    const key = property.startsWith('--') ? JSON.stringify(property) : /^-(webkit|moz|ms)-/.test(property) ? camel(property.slice(1)).replace(/^./, (c) => c.toUpperCase()) : camel(property.toLowerCase())
    return `${key}: ${JSON.stringify(value.replace(/\s*!important$/i, ''))}`
  })
  return `{{ ${entries.join(', ')} }}`
}

function attributes(tag: string, raw: string): string {
  const parts: string[] = []
  ATTR.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ATTR.exec(raw))) {
    const [, name, dq, sq, bare] = match
    if (!name) continue
    const lower = name.toLowerCase()
    if (lower.startsWith('on') || lower === 'contenteditable') continue
    const value = dq ?? sq ?? bare
    if (lower === 'style') {
      if (value?.trim()) parts.push(`style=${styleObject(value)}`)
      continue
    }
    let key = jsxName(name)
    if ((tag === 'input' || tag === 'select') && lower === 'value') key = 'defaultValue'
    if (tag === 'input' && lower === 'checked') key = 'defaultChecked'
    if (tag === 'option' && lower === 'selected') continue
    parts.push(value === undefined ? key : `${key}=${JSON.stringify(decode(value))}`)
  }
  return parts.length ? ' ' + parts.join(' ') : ''
}

const escapeText = (text: string) => text.replace(/[{}]/g, (ch) => `{'${ch}'}`)

/** Converts an HTML fragment to JSX. */
export function htmlToJsx(html: string): string {
  let out = ''
  let at = 0
  TOKEN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN.exec(html))) {
    out += escapeText(html.slice(at, match.index))
    at = TOKEN.lastIndex
    const [whole, comment, closing, rawTag, rawAttrs = '', selfClosing] = match
    if (comment !== undefined) {
      if (comment.trim() && !comment.includes('zeko:stream')) out += `{/* ${comment.trim().replace(/\*\//g, '* /')} */}`
      continue
    }
    if (!rawTag) continue
    const tag = /^[a-z]/.test(rawTag) && !rawTag.includes('-') && !/[A-Z]/.test(rawTag.slice(1)) ? rawTag.toLowerCase() : rawTag
    if (tag === 'script' || tag === 'style' || tag === 'textarea') {
      if (closing) continue
      const end = html.toLowerCase().indexOf(`</${tag}`, at)
      const inner = end < 0 ? html.slice(at) : html.slice(at, end)
      at = end < 0 ? html.length : html.indexOf('>', end) + 1
      TOKEN.lastIndex = at
      if (tag === 'style') out += `<style>{${JSON.stringify(inner)}}</style>`
      if (tag === 'textarea') out += `<textarea${attributes(tag, rawAttrs)} defaultValue=${JSON.stringify(inner)} />`
      continue
    }
    if (whole.toLowerCase().startsWith('<!doctype')) continue
    if (closing) {
      if (!VOID.has(tag)) out += `</${tag}>`
      continue
    }
    out += `<${tag}${attributes(tag, rawAttrs)}${VOID.has(tag) || selfClosing ? ' />' : '>'}`
  }
  return out + escapeText(html.slice(at))
}

export function componentName(name: string) {
  const words = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  const joined = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join('')
  return /^[A-Z]/.test(joined) ? joined : `Screen${joined}`
}

const indent = (text: string, spaces: number) => text.split('\n').map((line) => (line.trim() ? ' '.repeat(spaces) + line : line)).join('\n')

/**
 * A whole sketch document as a React component: head styles and fonts move into the component,
 * the body's own attributes become a wrapping element.
 */
export function documentToReact(html: string, name: string): string {
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? ''
  const styles = [...head.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)].map((m) => m[0])
  const fonts = [...head.matchAll(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi)].map((m) => m[0])
  const bodyMatch = /<body\b([^>]*)>([\s\S]*?)(?:<\/body>|$)/i.exec(html)
  const bodyAttrs = bodyMatch?.[1]?.trim() ?? ''
  let body = bodyMatch ? bodyMatch[2]! : html.replace(/<head\b[\s\S]*?<\/head>/i, '').replace(/<\/?html\b[^>]*>/gi, '').replace(/<!doctype[^>]*>/i, '')
  body = body.replace(/<script\b[\s\S]*?<\/script>/gi, '').trim()
  // Styles written in the body stay where they are; head styles join them at the top.
  const inner = [...fonts, ...styles, body].join('\n')
  const wrapper = bodyAttrs ? `<div${bodyAttrs.startsWith(' ') ? bodyAttrs : ' ' + bodyAttrs}>\n${inner}\n</div>` : `<>\n${inner}\n</>`
  return `export default function ${componentName(name)}() {\n  return (\n${indent(htmlToJsx(wrapper), 4)}\n  )\n}\n`
}

/** An element's inline style as a CSS rule. */
export function styleToCss(style: string, selector = '.element'): string {
  const lines = declarations(decode(style)).map(([property, value]) => `  ${property}: ${value};`)
  return `${selector} {\n${lines.join('\n')}\n}\n`
}
