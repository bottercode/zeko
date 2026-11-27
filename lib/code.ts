import { documentToReact } from './html-to-jsx'
import { tokenCss } from './tokens'
import type { BoardDesign } from './types'

export type CodeFormat = 'html' | 'react' | 'tokens'

/** Code for a whole sketch, with the canvas's design tokens defined so it renders on its own. */
export function frameCode(html: string, name: string, design: BoardDesign | undefined, format: CodeFormat): string {
  const tokens = tokenCss(design)
  if (format === 'tokens') return tokens ? tokens.replace(/^:root\{/, ':root {\n  ').replace(/;/g, ';\n  ').replace(/\}$/, ';\n}\n') : ''
  const withTokens = !tokens ? html : /<head\b[^>]*>/i.test(html)
    ? html.replace(/<head\b[^>]*>/i, (head) => `${head}<style>${tokens}</style>`)
    : `<style>${tokens}</style>${html}`
  return format === 'react' ? documentToReact(withTokens, name) : withTokens
}

/** What a developer needs to know beyond the markup: assets, fonts, tokens and components the sketch relies on. */
export function codeNotes(html: string) {
  const fonts = [...new Set([...html.matchAll(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]!).filter((href) => /fonts\./.test(href)))]
  const tokens = [...new Set([...html.matchAll(/var\(--([a-z][a-z0-9-]*)/g)].map((m) => m[1]!))]
  const embeddedImages = [...html.matchAll(/src=["']data:image\/([\w.+-]+);base64,/gi)].map((m) => m[1]!)
  const linkedImages = [...new Set([...html.matchAll(/src=["'](https?:[^"']+)["']/gi)].map((m) => m[1]!))]
  const instances = [...new Set([...html.matchAll(/data-zeko-instance=["']([^"']+)["']/g)].map((m) => m[1]!))]
  const shaders = [...html.matchAll(/data-zeko-shader=["']([^"']+)["']/g)].map((m) => m[1]!)
  return { fonts, tokens, embeddedImages: embeddedImages.length, linkedImages, componentIds: instances, shaders }
}
