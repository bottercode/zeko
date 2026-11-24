import type { BoardDesign, DesignToken, TokenKind } from './types'

export const TOKEN_STYLE_ID = '__zeko_tokens'
export const DEFAULT_THEME = 'default'
export const defaultDesign: BoardDesign = { themeId: DEFAULT_THEME, themes: [{ id: DEFAULT_THEME, name: 'Default' }], tokens: [] }

export const tokenLabels: Record<TokenKind, string> = {
  color: 'Color', opacity: 'Opacity', radius: 'Radius', spacing: 'Spacing', container: 'Container', breakpoint: 'Breakpoint',
  'font-family': 'Font family', 'font-weight': 'Font weight', 'font-size': 'Font size', 'line-height': 'Line height', 'letter-spacing': 'Letter spacing',
}

export const validTokenName = (name: string) => /^[a-z][a-z0-9-]{0,63}$/.test(name)
export const validTokenValue = (value: string) => !!value && value.length <= 256 && !/[<>{};\r\n]|\/\*/.test(value)

export function tokenValue(token: DesignToken, themeId: string) {
  const value = token.values?.[themeId] ?? token.values?.[DEFAULT_THEME]
  return typeof value === 'string' ? value : ''
}

export function tokenCss(design: BoardDesign | undefined): string {
  if (!design) return ''
  const declarations = design.tokens.flatMap((token) => {
    const value = tokenValue(token, design.themeId)
    return validTokenName(token.name) && validTokenValue(value) ? [`--${token.name}:${value}`] : []
  })
  return declarations.length ? `:root{${declarations.join(';')}}` : ''
}

export function withTokenCss(html: string, css: string) {
  if (!css) return html
  html = html.replace(/<style id="__zeko_tokens">[\s\S]*?<\/style>/gi, '')
  const tag = `<style id="${TOKEN_STYLE_ID}">${css}</style>`
  const head = /<\/head\s*>/i.exec(html)
  if (head) return html.slice(0, head.index) + tag + html.slice(head.index)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? ''
  return doctype + tag + html.slice(doctype.length)
}

export const withDesignTokens = (html: string, design: BoardDesign | undefined) => withTokenCss(html, tokenCss(design))

export function readDesign(value: unknown): BoardDesign | undefined {
  if (!value || typeof value !== 'object') return undefined
  const design = value as Partial<BoardDesign>
  if (!Array.isArray(design.themes) || !Array.isArray(design.tokens)) return undefined
  if (!design.themes.every((theme) => theme && typeof theme.id === 'string' && typeof theme.name === 'string')) return undefined
  if (!design.themes.some((theme) => theme.id === DEFAULT_THEME)) return undefined
  if (!design.tokens.every((token) => token && typeof token.name === 'string' && validTokenName(token.name)
    && Object.hasOwn(tokenLabels, token.kind) && token.values && Object.values(token.values).every((v) => typeof v === 'string' && validTokenValue(v)))) return undefined
  const themeId = design.themes.some((theme) => theme.id === design.themeId) ? design.themeId! : DEFAULT_THEME
  return { themeId, themes: design.themes, tokens: design.tokens }
}
