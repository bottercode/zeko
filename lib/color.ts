/*
 * Color math for the picker: OKLCH is perceptually uniform, so equal steps in lightness or hue look like equal
 * steps to the eye. Colors are kept as OKLCH and converted to sRGB or Display P3 for drawing and output.
 */

export type Gamut = 'srgb' | 'p3'

export interface Oklch {
  /** lightness, 0..1 */
  l: number
  /** chroma, 0..~0.4 */
  c: number
  /** hue in degrees, 0..360 */
  h: number
  /** alpha, 0..1 */
  a: number
}

type Vec3 = [number, number, number]

const mul = (m: number[][], v: Vec3): Vec3 => [
  m[0]![0]! * v[0] + m[0]![1]! * v[1] + m[0]![2]! * v[2],
  m[1]![0]! * v[0] + m[1]![1]! * v[1] + m[1]![2]! * v[2],
  m[2]![0]! * v[0] + m[2]![1]! * v[1] + m[2]![2]! * v[2],
]

const SRGB_TO_P3 = [[0.8224621, 0.177538, 0], [0.0331941, 0.9668058, 0], [0.0170827, 0.0723974, 0.9105199]]
const P3_TO_SRGB = [[1.2249401, -0.2249404, 0], [-0.0420569, 1.0420571, 0], [-0.0196376, -0.0786361, 1.0982735]]

/** sRGB and Display P3 share the same transfer curve. */
const toLinear = (c: number) => {
  const abs = Math.abs(c)
  return Math.sign(c) * (abs <= 0.04045 ? abs / 12.92 : ((abs + 0.055) / 1.055) ** 2.4)
}
const toGamma = (c: number) => {
  const abs = Math.abs(c)
  return Math.sign(c) * (abs <= 0.0031308 ? abs * 12.92 : 1.055 * abs ** (1 / 2.4) - 0.055)
}

function oklabToLinearSrgb([L, a, b]: Vec3): Vec3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function linearSrgbToOklab([r, g, b]: Vec3): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** OKLCH to gamma-encoded RGB in the given space. Channels may fall outside 0..1 when out of gamut. */
export function oklchToRgb({ l, c, h }: Pick<Oklch, 'l' | 'c' | 'h'>, gamut: Gamut = 'srgb'): Vec3 {
  const rad = (h * Math.PI) / 180
  const linear = oklabToLinearSrgb([l, c * Math.cos(rad), c * Math.sin(rad)])
  const space = gamut === 'p3' ? mul(SRGB_TO_P3, linear) : linear
  return space.map(toGamma) as Vec3
}

export function rgbToOklch([r, g, b]: Vec3, gamut: Gamut = 'srgb', a = 1): Oklch {
  const linear = [r, g, b].map(toLinear) as Vec3
  const [L, A, B] = linearSrgbToOklab(gamut === 'p3' ? mul(P3_TO_SRGB, linear) : linear)
  const c = Math.sqrt(A * A + B * B)
  const h = c < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360
  return { l: clamp(L, 0, 1), c, h, a: clamp(a, 0, 1) }
}

const EPSILON = 1e-4
export const inGamut = (rgb: Vec3) => rgb.every((v) => v >= -EPSILON && v <= 1 + EPSILON)

/** The most chroma a lightness and hue can carry inside a gamut. */
export function maxChroma(l: number, h: number, gamut: Gamut): number {
  if (l <= 0 || l >= 1) return 0
  let lo = 0
  let hi = 0.5
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2
    if (inGamut(oklchToRgb({ l, c: mid, h }, gamut))) lo = mid
    else hi = mid
  }
  return lo
}

/** Bring a color inside a gamut by lowering chroma, keeping lightness and hue. */
export function toGamut(color: Oklch, gamut: Gamut): Oklch {
  if (inGamut(oklchToRgb(color, gamut))) return color
  return { ...color, c: maxChroma(color.l, color.h, gamut) }
}

export function gamutOf(color: Oklch): Gamut | 'wide' {
  if (inGamut(oklchToRgb(color, 'srgb'))) return 'srgb'
  if (inGamut(oklchToRgb(color, 'p3'))) return 'p3'
  return 'wide'
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const round = (v: number, digits: number) => {
  const f = 10 ** digits
  return Math.round(v * f) / f
}
const alphaPart = (a: number) => (a < 1 ? ` / ${round(a * 100, 1)}%` : '')

export function formatOklch(color: Oklch): string {
  return `oklch(${round(color.l * 100, 2)}% ${round(color.c, 4)} ${round(color.h, 2)}${alphaPart(color.a)})`
}

export function formatHex(color: Oklch): string {
  const rgb = oklchToRgb(toGamut(color, 'srgb'), 'srgb')
  const hex = rgb.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('')
  const alpha = color.a < 1 ? Math.round(color.a * 255).toString(16).padStart(2, '0') : ''
  return `#${hex}${alpha}`
}

export function formatP3(color: Oklch): string {
  const rgb = oklchToRgb(toGamut(color, 'p3'), 'p3')
  return `color(display-p3 ${rgb.map((v) => round(clamp(v, 0, 1), 4)).join(' ')}${alphaPart(color.a)})`
}

export type ColorFormat = 'oklch' | 'hex' | 'p3'

export function formatColor(color: Oklch, format: ColorFormat): string {
  return format === 'hex' ? formatHex(color) : format === 'p3' ? formatP3(color) : formatOklch(color)
}

/** Picks the format that keeps the color: hex for sRGB colors written as hex, oklch otherwise. */
export function preferredFormat(source: string): ColorFormat {
  const value = source.trim().toLowerCase()
  if (value.startsWith('#')) return 'hex'
  if (value.startsWith('color(display-p3')) return 'p3'
  return 'oklch'
}

const number = (part: string | undefined, percentScale = 1) => {
  if (part === undefined || part === 'none') return 0
  return part.endsWith('%') ? (parseFloat(part) / 100) * percentScale : parseFloat(part)
}

/**
 * Reads the color forms browsers report from getComputedStyle and the forms people type: hex,
 * rgb()/rgba(), oklch(), and color(srgb|display-p3 …). Returns null for anything else.
 */
export function parseColor(input: string): Oklch | null {
  const value = input.trim().toLowerCase()
  if (!value) return null
  if (value === 'transparent') return { l: 0, c: 0, h: 0, a: 0 }
  const hex = /^#([0-9a-f]{3,8})$/.exec(value)?.[1]
  if (hex) {
    if (![3, 4, 6, 8].includes(hex.length)) return null
    const full = hex.length <= 4 ? [...hex].map((ch) => ch + ch).join('') : hex
    const channels = [0, 2, 4, 6].map((i) => parseInt(full.slice(i, i + 2) || 'ff', 16) / 255)
    return rgbToOklch([channels[0]!, channels[1]!, channels[2]!], 'srgb', channels[3])
  }
  if (/^[a-z]+$/.test(value)) return parseNamed(value)
  const fn = /^([a-z-]+)\((.*)\)$/.exec(value)
  if (!fn) return null
  const [, name, body] = fn
  const [main, alphaText] = body!.split('/').map((part) => part.trim())
  const parts = main!.replace(/,/g, ' ').split(/\s+/).filter(Boolean)
  let alpha = alphaText !== undefined ? number(alphaText) : 1
  if (name === 'rgb' || name === 'rgba') {
    if (parts.length < 3) return null
    if (parts[3] !== undefined) alpha = number(parts[3])
    const rgb = parts.slice(0, 3).map((part) => (part.endsWith('%') ? number(part) : number(part) / 255)) as Vec3
    return rgbToOklch(rgb, 'srgb', alpha)
  }
  if (name === 'oklch') {
    if (parts.length < 3) return null
    return { l: clamp(number(parts[0]), 0, 1), c: Math.max(0, number(parts[1], 0.4)), h: (number(parts[2]) % 360 + 360) % 360, a: clamp(alpha, 0, 1) }
  }
  if (name === 'color') {
    const [space, ...rest] = parts
    if (rest.length < 3 || (space !== 'srgb' && space !== 'display-p3')) return null
    return rgbToOklch(rest.slice(0, 3).map((part) => number(part)) as Vec3, space === 'display-p3' ? 'p3' : 'srgb', alpha)
  }
  return null
}

/** A CSS color a browser can paint in the given gamut, for swatches. */
export function cssSwatch(color: Oklch): string {
  return formatOklch(color)
}

const NAMED: Record<string, string> = { white: '#ffffff', black: '#000000', red: '#ff0000', blue: '#0000ff', green: '#008000', gray: '#808080', grey: '#808080' }
let namedProbe: CanvasRenderingContext2D | null | undefined

/** A CSS named color, such as white or rebeccapurple. The browser knows all of them; elsewhere only the common few. */
function parseNamed(name: string): Oklch | null {
  if (name === 'currentcolor' || name === 'inherit' || name === 'initial' || name === 'unset') return null
  if (namedProbe === undefined) namedProbe = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  if (namedProbe) {
    // An unknown name leaves fillStyle unchanged, so try two different starting colors to tell.
    namedProbe.fillStyle = '#000000'
    namedProbe.fillStyle = name
    const first = namedProbe.fillStyle
    namedProbe.fillStyle = '#ffffff'
    namedProbe.fillStyle = name
    if (first !== namedProbe.fillStyle) return null
    return parseColor(first)
  }
  return NAMED[name] ? parseColor(NAMED[name]) : null
}
