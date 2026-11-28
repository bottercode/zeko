import 'server-only'
import { existsSync } from 'node:fs'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { personalWorkspace } from './store'

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
  if (g.__zekoBrowser) return g.__zekoBrowser
  const launch = puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    pipe: true,
    env: process.env.ZEKO_HOSTED === '1' ? { PATH: process.env.PATH, HOME: process.env.HOME } : undefined,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--mute-audio'],
  })
  g.__zekoBrowser = launch
  const forget = () => { if (g.__zekoBrowser === launch) delete g.__zekoBrowser }
  void launch.then((instance) => instance.once('disconnected', forget), forget)
  return launch
}

export async function withSketchPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const b = await browser()
  const context = await b.createBrowserContext()
  try {
    const page = await context.newPage()
    if (personalWorkspace()) {
      await page.setJavaScriptEnabled(false)
      await page.setOfflineMode(true)
      await page.setRequestInterception(true)
      page.on('request', (request) => {
        const embedded = /^(?:data:|blob:|about:blank$)/.test(request.url())
        void (embedded ? request.continue() : request.abort()).catch(() => undefined)
      })
    }
    return await fn(page)
  } finally {
    await context.close().catch(() => undefined)
  }
}

/**
 * A page that may load the web, for capturing live sites. Every request passes the guard first, so a page
 * cannot reach addresses the guard refuses, including through redirects or its own subresources.
 */
export async function withWebPage<T>(guard: (url: string) => Promise<boolean>, fn: (page: Page) => Promise<T>): Promise<T> {
  const b = await browser()
  const context = await b.createBrowserContext()
  try {
    const page = await context.newPage()
    await page.setRequestInterception(true)
    page.on('request', (request) => {
      if (request.isInterceptResolutionHandled()) return
      const url = request.url()
      if (/^(?:data:|blob:|about:blank$)/.test(url)) return void request.continue().catch(() => undefined)
      void guard(url).then((ok) => (ok ? request.continue() : request.abort('blockedbyclient'))).catch(() => request.abort().catch(() => undefined))
    })
    return await fn(page)
  } finally {
    await context.close().catch(() => undefined)
  }
}

async function withPage<T>(html: string, width: number, height: number, scale: number, fn: (page: Page) => Promise<T>): Promise<T> {
  return withSketchPage(async (page) => {
    await page.setViewport({ width: Math.round(width), height: Math.round(height), deviceScaleFactor: scale })
    // Sketches are the agent's own HTML; give fonts and images a moment, but never hang on them.
    await page.setContent(html, { waitUntil: 'load', timeout: 8000 }).catch(() => undefined)
    await page.evaluate(() => Promise.race([
      document.fonts.ready,
      new Promise((resolve) => window.setTimeout(resolve, 1200)),
    ])).catch(() => undefined)
    return fn(page)
  })
}

export interface ShotOptions {
  width: number
  height: number
  scale?: number
  /** capture the whole document, not only the frame's size */
  fullPage?: boolean
  format?: 'png' | 'jpeg'
}

export async function screenshot(html: string, o: ShotOptions): Promise<Buffer> {
  const scale = Math.min(3, Math.max(0.25, o.scale ?? 1))
  return withPage(html, o.width, o.height, scale, async (page) => {
    const format = o.format ?? 'png'
    const image = await page.screenshot({
      type: format,
      ...(format === 'jpeg' ? { quality: 84 } : {}),
      fullPage: !!o.fullPage,
      captureBeyondViewport: !!o.fullPage,
    })
    return Buffer.from(image)
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
  /** font families the sketch asks for that did not load, so the browser fell back to another face */
  missingFonts: string[]
  /** weights used for a loaded web font that the page never loaded, so the browser synthesizes them */
  missingWeights: string[]
  /** text whose contrast with the color behind it is below WCAG AA (4.5:1, or 3:1 for large text) */
  lowContrast: { path: string; text: string; ratio: number; size: number; color: string; background: string }[]
  /** visible text set below 12px */
  tinyText: { path: string; text: string; size: number }[]
  colors: string[]
  tree: InspectNode[]
}

/** The layout an agent can reason about: element boxes, text, fonts, colors and overflow, plus the craft checks. */
export async function inspect(html: string, width: number, height: number, depth = 6): Promise<Inspection> {
  return withPage(html, width, height, 1, (page) =>
    page.evaluate(
      (maxDepth: number, frameW: number, frameH: number) => {
        const fonts = new Set<string>()
        const colors = new Set<string>()
        const weights = new Map<string, Set<number>>()
        const lowContrast: Inspection['lowContrast'] = []
        const tinyText: Inspection['tinyText'] = []
        const rgba = (value: string) => {
          const m = value.match(/rgba?\(([^)]+)\)/)
          if (!m) return undefined
          const [r, g, b, a] = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number)
          return [r!, g!, b!, a ?? 1] as const
        }
        const luminance = ([r, g, b]: readonly number[]) => {
          const channel = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
          return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!)
        }
        const over = (top: readonly number[], bottom: readonly number[]) => {
          const a = top[3]!
          return [0, 1, 2].map((i) => top[i]! * a + bottom[i]! * (1 - a)).concat(1)
        }
        /* The solid color behind an element, or undefined when an image or gradient sits behind it. */
        const backdrop = (el: Element): number[] | undefined => {
          const layers: (readonly number[])[] = []
          for (let node: Element | null = el; node; node = node.parentElement) {
            const cs = getComputedStyle(node)
            if (cs.backgroundImage && cs.backgroundImage !== 'none') return undefined
            const c = rgba(cs.backgroundColor)
            if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break }
          }
          return layers.reduceRight<number[]>((acc, layer) => over(layer, acc), [255, 255, 255, 1])
        }
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
          if (own) {
            node.text = own.slice(0, 80)
            const family = cs.fontFamily.split(',')[0]!.replace(/["']/g, '').trim()
            const set = weights.get(family) ?? new Set<number>()
            set.add(Number(cs.fontWeight) || 400)
            weights.set(family, set)
            const size = parseFloat(cs.fontSize)
            if (size < 12 && tinyText.length < 8) tinyText.push({ path, text: own.slice(0, 40), size })
            const fg = rgba(cs.color)
            const bg = backdrop(el)
            if (fg && bg && Number(cs.opacity) > 0 && lowContrast.length < 12) {
              const ink = over([fg[0], fg[1], fg[2], fg[3] * Number(cs.opacity)], bg)
              const [hi, lo] = [luminance(ink), luminance(bg)].sort((a, b) => b - a)
              const ratio = Math.round(((hi! + 0.05) / (lo! + 0.05)) * 100) / 100
              const large = size >= 24 || (size >= 18.66 && (Number(cs.fontWeight) || 400) >= 700)
              if (ratio < (large ? 3 : 4.5)) {
                lowContrast.push({ path, text: own.slice(0, 40), ratio, size, color: cs.color, background: `rgb(${bg.slice(0, 3).map(Math.round).join(', ')})` })
              }
            }
          }
          /* Walk the whole page so the checks see every element; the tree only goes maxDepth deep. */
          const kids = [...el.children]
            .filter((c) => !['SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT'].includes(c.tagName))
            .map((c, i) => walk(c, `${path}.${i}`, d + 1))
            .filter((n): n is InspectNode => !!n)
          if (kids.length && d < maxDepth) node.children = kids
          return node
        }
        const body = document.body
        const tree = body
          ? [...body.children]
              .filter((c) => !['SCRIPT', 'STYLE'].includes(c.tagName))
              .map((c, i) => walk(c, String(i), 1))
              .filter((n): n is InspectNode => !!n)
          : []
        const generic = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif',
          'ui-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong', '-apple-system', 'BlinkMacSystemFont'])
        /* A family is missing when text set in it measures the same as the fallback alone, against two fallbacks. */
        const probe = document.createElement('span')
        probe.textContent = 'Hamburgefonstiv 0123456789'
        probe.style.cssText = 'position:absolute;visibility:hidden;font-size:72px;white-space:nowrap;left:-9999px'
        document.body?.appendChild(probe)
        const widthIn = (font: string) => { probe.style.fontFamily = font; return probe.getBoundingClientRect().width }
        const missingFonts = [...fonts].filter((family) => family && !generic.has(family) &&
          widthIn(`"${family}", monospace`) === widthIn('monospace') && widthIn(`"${family}", serif`) === widthIn('serif'))
        probe.remove()
        const faces = [...document.fonts]
        const missingWeights: string[] = []
        for (const [family, used] of weights) {
          const loaded = faces.filter((face) => face.family.replace(/["']/g, '') === family && face.status === 'loaded')
          if (!loaded.length || missingFonts.includes(family)) continue
          for (const weight of used) {
            const covered = loaded.some((face) => {
              const [lo, hi = lo] = face.weight.split(/\s+/).map((w) => (w === 'normal' ? 400 : w === 'bold' ? 700 : Number(w)))
              return weight >= lo! && weight <= hi!
            })
            if (!covered) missingWeights.push(`${family} ${weight}`)
          }
        }
        const contentHeight = Math.ceil(document.documentElement.scrollHeight)
        const contentWidth = Math.ceil(document.documentElement.scrollWidth)
        return {
          contentHeight,
          contentWidth,
          overflowsFrame: contentHeight > frameH + 1 || contentWidth > frameW + 1,
          fonts: [...fonts].filter(Boolean).slice(0, 8),
          missingFonts,
          missingWeights,
          lowContrast,
          tinyText,
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

/** The craft checks from an inspection as short lines for a reviewing agent; empty when nothing fails. */
export function craftFindings(result: Inspection): string[] {
  const lines: string[] = []
  if (result.overflowsFrame) lines.push(`Content is ${result.contentWidth}x${result.contentHeight}, larger than the frame: fit_frame_to_content or fix the layout.`)
  if (result.missingFonts.length) lines.push(`Fonts that did not load (the browser fell back): ${result.missingFonts.join(', ')}. Load them in <head> or choose another family.`)
  if (result.missingWeights.length) lines.push(`Weights used but not loaded (synthesized): ${result.missingWeights.join(', ')}. Add them to the font request.`)
  for (const item of result.lowContrast) {
    lines.push(`Low contrast ${item.ratio}:1 at ${item.path} ("${item.text}", ${item.size}px, ${item.color} on ${item.background}).`)
  }
  if (result.tinyText.length) lines.push(`Text under 12px: ${result.tinyText.map((t) => `${t.path} ${t.size}px "${t.text}"`).join('; ')}.`)
  return lines
}
