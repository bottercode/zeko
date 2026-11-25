import 'server-only'
import { existsSync } from 'node:fs'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'

/* Draws sketches in a headless Chrome so agents can look at their work and people can export it.
   Uses the Chrome already on the machine; set ZEKO_CHROME to point somewhere else. */

const CANDIDATES = [
  process.env.ZEKO_CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]

export class RenderUnavailable extends Error {}

function chromePath() {
  const found = CANDIDATES.find((p) => p && existsSync(p))
  if (!found) throw new RenderUnavailable('No Chrome found. Install Google Chrome or set ZEKO_CHROME to a Chromium-based browser.')
  return found
}

const g = globalThis as typeof globalThis & { __zekoBrowser?: Promise<Browser> }

async function browser(): Promise<Browser> {
  const existing = g.__zekoBrowser
  if (existing) {
    const b = await existing.catch(() => null)
    if (b?.connected) return b
  }
  g.__zekoBrowser = puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    pipe: true,
    env: process.env.ZEKO_HOSTED === '1' ? { PATH: process.env.PATH, HOME: process.env.HOME } : undefined,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--mute-audio'],
  })
  return g.__zekoBrowser
}

export async function withSketchPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const b = await browser()
  const context = await b.createBrowserContext()
  try {
    return await fn(await context.newPage())
  } finally {
    await context.close().catch(() => undefined)
  }
}

async function withPage<T>(html: string, width: number, height: number, scale: number, fn: (page: Page) => Promise<T>): Promise<T> {
  return withSketchPage(async (page) => {
    await page.setViewport({ width: Math.round(width), height: Math.round(height), deviceScaleFactor: scale })
    // Sketches are the agent's own HTML; give fonts and images a moment, but never hang on them.
    await page.setContent(html, { waitUntil: 'load', timeout: 8000 }).catch(() => undefined)
    await page.evaluate(() => document.fonts?.ready).catch(() => undefined)
    return fn(page)
  })
}

export interface ShotOptions {
  width: number
  height: number
  scale?: number
  /** capture the whole document, not only the frame's size */
  fullPage?: boolean
}

export async function screenshot(html: string, o: ShotOptions): Promise<Buffer> {
  const scale = Math.min(3, Math.max(0.25, o.scale ?? 1))
  return withPage(html, o.width, o.height, scale, async (page) => {
    const png = await page.screenshot({ type: 'png', fullPage: !!o.fullPage, captureBeyondViewport: !!o.fullPage })
    return Buffer.from(png)
  })
}

export async function framePdf(html: string, width: number, height: number): Promise<Uint8Array> {
  return withPage(html, width, height, 1, async (page) => {
    await page.emulateMediaType('screen')
    return page.pdf({ width, height, printBackground: true, pageRanges: '1' })
  })
}

export interface InspectNode {
  path: string
  tag: string
  id?: string
  cls?: string
  text?: string
  box: [number, number, number, number]
  children?: InspectNode[]
}

export interface Inspection {
  contentHeight: number
  contentWidth: number
  overflowsFrame: boolean
  fonts: string[]
  colors: string[]
  tree: InspectNode[]
}

/** The layout an agent can reason about: element boxes, text, fonts, colors and overflow. */
export async function inspect(html: string, width: number, height: number, depth = 6): Promise<Inspection> {
  return withPage(html, width, height, 1, (page) =>
    page.evaluate(
      (maxDepth: number, frameW: number, frameH: number) => {
        const fonts = new Set<string>()
        const colors = new Set<string>()
        const walk = (el: Element, path: string, d: number): InspectNode | null => {
          const r = el.getBoundingClientRect()
          const cs = getComputedStyle(el)
          if (cs.display === 'none' || (r.width === 0 && r.height === 0)) return null
          fonts.add(cs.fontFamily.split(',')[0]!.replace(/["']/g, '').trim())
          if (cs.color) colors.add(cs.color)
          if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') colors.add(cs.backgroundColor)
          const own = [...el.childNodes]
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent?.trim())
            .filter(Boolean)
            .join(' ')
          const node: InspectNode = {
            path,
            tag: el.tagName.toLowerCase(),
            box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          }
          if (el.id) node.id = el.id
          if (el.classList.length) node.cls = [...el.classList].slice(0, 4).join(' ')
          if (own) node.text = own.slice(0, 80)
          if (d < maxDepth) {
            const kids = [...el.children]
              .filter((c) => !['SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT'].includes(c.tagName))
              .map((c, i) => walk(c, `${path}.${i}`, d + 1))
              .filter((n): n is InspectNode => !!n)
            if (kids.length) node.children = kids
          }
          return node
        }
        const body = document.body
        const tree = body
          ? [...body.children]
              .filter((c) => !['SCRIPT', 'STYLE'].includes(c.tagName))
              .map((c, i) => walk(c, String(i), 1))
              .filter((n): n is InspectNode => !!n)
          : []
        const contentHeight = Math.ceil(document.documentElement.scrollHeight)
        const contentWidth = Math.ceil(document.documentElement.scrollWidth)
        return {
          contentHeight,
          contentWidth,
          overflowsFrame: contentHeight > frameH + 1 || contentWidth > frameW + 1,
          fonts: [...fonts].filter(Boolean).slice(0, 8),
          colors: [...colors].slice(0, 16),
          tree,
        }
      },
      depth,
      width,
      height,
    ),
  )
}
