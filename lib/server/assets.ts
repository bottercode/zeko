import 'server-only'
import { withSketchPage } from './render'
import { assertFetchable } from './safe-url'

/*
 * Images and drawings that agents bring to a sketch. Zeko makes none itself: people's own agents, connected
 * over MCP or ACP, create them with their own tools, and Zeko checks, compacts and places them.
 */

export interface SourceImage {
  data: Uint8Array
  mediaType: string
}

/** Reads an image from a data URL or an http(s) address. In hosted mode, private-network addresses are refused. */
export async function readSourceImage(src: string): Promise<SourceImage> {
  const data = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/i.exec(src)
  if (data) {
    const bytes = new Uint8Array(Buffer.from(data[2]!, 'base64'))
    if (bytes.byteLength > 12 * 1024 * 1024) throw new Error('That image is over 12 MB.')
    return { mediaType: data[1]!.toLowerCase(), data: bytes }
  }
  if (!/^https?:\/\//i.test(src)) throw new Error('The image must be a data URL or an http(s) address.')
  const url = await assertFetchable(src)
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) }).catch(() => {
    throw new Error(`Couldn’t download ${url.hostname}: pass a reachable https address or a data URL.`)
  })
  const type = response.headers.get('content-type')?.split(';')[0] ?? ''
  if (!response.ok || !type.startsWith('image/')) throw new Error('Couldn’t download that image.')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > 12 * 1024 * 1024) throw new Error('That image is over 12 MB.')
  return { data: bytes, mediaType: type }
}

/**
 * Re-encodes an image as WebP no larger than the place it fills (at 2x), so it fits inside a sketch's HTML.
 * Falls back to the original bytes when no browser is available to encode.
 */
export async function compactImage(image: SourceImage, maxWidth: number, maxHeight: number): Promise<string> {
  const original = `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}`
  try {
    return await withSketchPage((page) => page.evaluate(async (src: string, w: number, h: number) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const scale = Math.min(1, w / img.naturalWidth, h / img.naturalHeight)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      const webp = canvas.toDataURL('image/webp', 0.86)
      return webp.startsWith('data:image/webp') && webp.length < src.length ? webp : src
    }, original, Math.max(64, Math.min(2400, maxWidth * 2)), Math.max(64, Math.min(2400, maxHeight * 2))))
  } catch {
    return original
  }
}

/** Strips anything active or external from an SVG, keeping only drawing. */
export function sanitizeSvg(input: string): string {
  const start = input.search(/<svg[\s>]/i)
  const end = input.toLowerCase().lastIndexOf('</svg>')
  if (start < 0 || end < start) throw new Error('That is not an SVG: pass one complete <svg> element.')
  let svg = input.slice(start, end + 6)
  svg = svg
    .replace(/<(script|foreignObject|iframe|embed|object|audio|video|image)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|foreignObject|iframe|embed|object|audio|video|image)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(\s(?:xlink:)?href\s*=\s*)(["'])(?!#)[^"']*\2/gi, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(?!['"]?#)[^)]*\)/gi, 'none')
    .replace(/javascript:/gi, '')
  if (!/\sxmlns=/.test(svg.slice(0, svg.indexOf('>')))) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"')
  if (svg.length > 400_000) throw new Error('That SVG is over 400 KB.')
  return svg
}

/** Confirms the SVG parses, so a broken drawing never reaches a sketch. */
export async function checkSvg(svg: string) {
  try {
    const error = await withSketchPage((page) => page.evaluate((source: string) => {
      const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
      return doc.querySelector('parsererror')?.textContent ?? (doc.documentElement.localName === 'svg' ? null : 'Not an SVG document.')
    }, svg))
    if (error) throw new Error(`That SVG is invalid: ${error.slice(0, 200)}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('That SVG')) throw error
    // Without a browser to check in, the sanitized markup is still safe to use.
  }
}

