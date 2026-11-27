'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pipette } from 'lucide-react'
import {
  clamp, formatColor, formatOklch, gamutOf, maxChroma, oklchToRgb, parseColor, preferredFormat, toGamut,
  type ColorFormat, type Gamut, type Oklch,
} from '@/lib/color'
import type { DesignToken } from '@/lib/types'
import { tokenValue } from '@/lib/tokens'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { cx } from './kit'

const MAP_W = 232
const MAP_H = 164
const FALLBACK: Oklch = { l: 0.62, c: 0.19, h: 264, a: 1 }

interface EyeDropperResult { sRGBHex: string }
type EyeDropperConstructor = new () => { open: () => Promise<EyeDropperResult> }

/** A token reference, optionally faded: color-mix keeps the token live when the theme changes. */
export function tokenColor(name: string, opacity: number) {
  return opacity >= 100 ? `var(--${name})` : `color-mix(in oklch, var(--${name}) ${Math.round(opacity)}%, transparent)`
}

/** Reads `var(--name)` or the color-mix form back into a token and opacity. */
export function readTokenColor(value: string): { name: string; opacity: number } | null {
  const plain = /^var\(--([a-z][a-z0-9-]*)\)$/.exec(value.trim())
  if (plain) return { name: plain[1]!, opacity: 100 }
  const mixed = /^color-mix\(in oklch, var\(--([a-z][a-z0-9-]*)\) (\d+(?:\.\d+)?)%, transparent\)$/.exec(value.trim())
  return mixed ? { name: mixed[1]!, opacity: Number(mixed[2]) } : null
}

const supportsP3 = () => typeof window !== 'undefined' && window.matchMedia?.('(color-gamut: p3)').matches

export function ColorPicker({ value, onChange, tokens = [], themeId, label, children }: {
  value: string
  onChange: (css: string) => void
  tokens?: DesignToken[]
  themeId?: string
  label: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<button type="button" aria-label={`Choose ${label.toLowerCase()}`} className="block size-full cursor-pointer" />}>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-[258px]" side="left" align="start" sideOffset={12}>
        {open && <PickerBody value={value} onChange={onChange} tokens={tokens} themeId={themeId} label={label} />}
      </PopoverContent>
    </Popover>
  )
}

function PickerBody({ value, onChange, tokens, themeId, label }: {
  value: string
  onChange: (css: string) => void
  tokens: DesignToken[]
  themeId?: string
  label: string
}) {
  const token = readTokenColor(value)
  const [color, setColor] = useState<Oklch>(() => {
    const source = token ? tokens.find((t) => t.name === token.name) : undefined
    const parsed = parseColor(source ? tokenValue(source, themeId ?? 'default') : value)
    // A transparent fill starts from a visible color, so the first drag shows something.
    return parsed && parsed.a > 0 ? parsed : FALLBACK
  })
  const [gamut, setGamut] = useState<Gamut>(() => (gamutOf(color) === 'srgb' ? 'srgb' : 'p3'))
  const [format, setFormat] = useState<ColorFormat>(() => preferredFormat(value))
  const [tokenOpacity, setTokenOpacity] = useState(token?.opacity ?? 100)
  const [activeToken, setActiveToken] = useState(token?.name ?? null)
  const colorTokens = tokens.filter((t) => t.kind === 'color')

  const commit = (next: Oklch, nextFormat = format) => {
    setColor(next)
    setActiveToken(null)
    onChange(formatColor(next, nextFormat))
  }
  const pickToken = (name: string, opacity: number) => {
    setActiveToken(name)
    setTokenOpacity(opacity)
    onChange(tokenColor(name, opacity))
  }

  const eyeDropper = typeof window !== 'undefined' ? (window as unknown as { EyeDropper?: EyeDropperConstructor }).EyeDropper : undefined
  const text = activeToken ? tokenColor(activeToken, tokenOpacity) : formatColor(color, format)
  const outside = gamutOf(color)

  return (
    <div className="flex flex-col gap-2.5" aria-label={`${label} picker`}>
      <ColorMap color={color} gamut={gamut} onChange={(next) => commit(next)} />
      <HueSlider hue={color.h} onChange={(h) => commit(toGamut({ ...color, h }, gamut))} />
      <AlphaSlider color={color} onChange={(a) => commit({ ...color, a })} />
      <div className="flex items-center gap-1.5">
        <ToggleGroup aria-label="Color gamut" size="sm" variant="outline" spacing={0} value={[gamut]}
          onValueChange={([next]) => {
            if (!next) return
            setGamut(next as Gamut)
            if (next === 'srgb' && outside !== 'srgb') commit(toGamut(color, 'srgb'))
          }}>
          <ToggleGroupItem value="srgb" className="px-2 text-xs">sRGB</ToggleGroupItem>
          <ToggleGroupItem value="p3" className="px-2 text-xs" title={supportsP3() ? 'Display P3' : 'Display P3: this screen shows the nearest sRGB color'}>P3</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup aria-label="Color format" size="sm" variant="outline" spacing={0} value={[format]} className="ml-auto"
          onValueChange={([next]) => {
            if (!next) return
            setFormat(next as ColorFormat)
            if (!activeToken) onChange(formatColor(color, next as ColorFormat))
          }}>
          <ToggleGroupItem value="oklch" className="px-1.5 text-xs">OKLCH</ToggleGroupItem>
          <ToggleGroupItem value="hex" className="px-1.5 text-xs">Hex</ToggleGroupItem>
          <ToggleGroupItem value="p3" className="px-1.5 text-xs">P3</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="flex items-center gap-1.5">
        <Input key={text} aria-label={`${label} CSS value`} defaultValue={text} spellCheck={false} autoComplete="off"
          className="h-7 min-w-0 flex-1 font-mono text-xs"
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          onBlur={(event) => {
            const next = event.currentTarget.value.trim()
            if (next === text) return
            const ref = readTokenColor(next)
            if (ref) return pickToken(ref.name, ref.opacity)
            const parsed = parseColor(next)
            if (parsed) {
              setFormat(preferredFormat(next))
              commit(parsed, preferredFormat(next))
            } else if (CSS.supports('color', next)) {
              setActiveToken(null)
              onChange(next)
            } else event.currentTarget.value = text
          }} />
        {eyeDropper && (
          <Button type="button" size="icon-sm" variant="outline" aria-label="Pick a color from the screen"
            onClick={async () => {
              try {
                const { sRGBHex } = await new eyeDropper().open()
                const parsed = parseColor(sRGBHex)
                if (parsed) commit({ ...parsed, a: color.a })
              } catch {
                // The person closed the eyedropper.
              }
            }}>
            <Pipette aria-hidden />
          </Button>
        )}
      </div>
      {outside !== 'srgb' && !activeToken && (
        <p className="text-xs text-muted-foreground">
          {outside === 'p3' ? 'Wide-gamut color: sRGB screens show the nearest color.' : 'Outside Display P3: screens show the nearest color.'}
        </p>
      )}
      {colorTokens.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
          <span className="text-xs font-medium text-muted-foreground">Tokens</span>
          <div className="flex flex-wrap gap-1">
            {colorTokens.map((t) => (
              <button key={t.name} type="button" title={`--${t.name}`} aria-label={`Use token --${t.name}`} aria-pressed={activeToken === t.name}
                onClick={() => pickToken(t.name, tokenOpacity)}
                className={cx('inspector-swatch size-6 rounded-md border border-input', activeToken === t.name && 'ring-2 ring-ring ring-offset-1')}
                style={{ background: `var(--${t.name}, ${tokenValue(t, themeId ?? 'default')})` }} />
            ))}
          </div>
          {activeToken && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Opacity
              <input type="range" min={0} max={100} value={tokenOpacity} aria-label="Token opacity"
                onChange={(event) => pickToken(activeToken, Number(event.currentTarget.value))}
                className="min-w-0 flex-1 accent-current" />
              <span className="w-8 text-right tabular-nums">{tokenOpacity}%</span>
            </label>
          )}
        </div>
      )}
    </div>
  )
}

/** Lightness down, chroma across, for one hue. Each row spans the chroma that lightness can hold in the gamut. */
function ColorMap({ color, gamut, onChange }: { color: Oklch; gamut: Gamut; onChange: (color: Oklch) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const rows = useRef<number[]>([])

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const space = gamut === 'p3' && supportsP3() ? 'display-p3' : 'srgb'
    const ctx = el.getContext('2d', { colorSpace: space })
    if (!ctx) return
    const image = ctx.createImageData(MAP_W, MAP_H, { colorSpace: space })
    const limits: number[] = []
    for (let y = 0; y < MAP_H; y++) {
      const l = 1 - y / (MAP_H - 1)
      const max = maxChroma(l, color.h, gamut)
      limits.push(max)
      for (let x = 0; x < MAP_W; x++) {
        const rgb = oklchToRgb({ l, c: (x / (MAP_W - 1)) * max, h: color.h }, space === 'display-p3' ? 'p3' : 'srgb')
        const i = (y * MAP_W + x) * 4
        image.data[i] = clamp(rgb[0], 0, 1) * 255
        image.data[i + 1] = clamp(rgb[1], 0, 1) * 255
        image.data[i + 2] = clamp(rgb[2], 0, 1) * 255
        image.data[i + 3] = 255
      }
    }
    rows.current = limits
    ctx.putImageData(image, 0, 0)
  }, [color.h, gamut])

  const max = maxChroma(color.l, color.h, gamut)
  const x = max > 0 ? clamp(color.c / max, 0, 1) : 0
  const y = 1 - color.l

  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const r = event.currentTarget.getBoundingClientRect()
    const px = clamp((event.clientX - r.left) / r.width, 0, 1)
    const py = clamp((event.clientY - r.top) / r.height, 0, 1)
    const l = 1 - py
    onChange({ ...color, l, c: px * maxChroma(l, color.h, gamut) })
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Lightness and chroma"
      aria-valuetext={formatOklch(color)}
      aria-valuenow={Math.round(color.l * 100)}
      className="relative h-[164px] w-full cursor-crosshair touch-none overflow-hidden rounded-md ring-1 ring-foreground/10 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        pick(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event)
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.05 : 0.01
        const moves: Record<string, [number, number]> = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowRight: [step, 0], ArrowLeft: [-step, 0] }
        const move = moves[event.key]
        if (!move) return
        event.preventDefault()
        const l = clamp(color.l + move[1], 0, 1)
        const rel = clamp(x + move[0], 0, 1)
        onChange({ ...color, l, c: rel * maxChroma(l, color.h, gamut) })
      }}
    >
      <canvas ref={canvas} width={MAP_W} height={MAP_H} className="size-full" />
      <span aria-hidden className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35)]"
        style={{ left: `${x * 100}%`, top: `${y * 100}%`, background: formatOklch({ ...color, a: 1 }) }} />
    </div>
  )
}

const HUE_STOPS = Array.from({ length: 13 }, (_, i) => `oklch(0.72 0.15 ${i * 30})`).join(', ')

function Track({ label, value, max, background, onChange, valueText }: {
  label: string
  value: number
  max: number
  background: string
  onChange: (value: number) => void
  valueText: string
}) {
  const set = (event: React.PointerEvent<HTMLDivElement>) => {
    const r = event.currentTarget.getBoundingClientRect()
    onChange(clamp((event.clientX - r.left) / r.width, 0, 1) * max)
  }
  return (
    <div role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)} aria-valuetext={valueText}
      className="relative h-3 w-full cursor-pointer touch-none rounded-full ring-1 ring-foreground/10 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ background }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        set(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) set(event)
      }}
      onKeyDown={(event) => {
        const step = (event.shiftKey ? 10 : 1) * (max / 100)
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') onChange(clamp(value + step, 0, max))
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') onChange(clamp(value - step, 0, max))
        else return
        event.preventDefault()
      }}>
      <span aria-hidden className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35)]"
        style={{ left: `${(value / max) * 100}%` }} />
    </div>
  )
}

function HueSlider({ hue, onChange }: { hue: number; onChange: (hue: number) => void }) {
  return <Track label="Hue" value={hue} max={360} background={`linear-gradient(to right, ${HUE_STOPS})`} onChange={onChange} valueText={`${Math.round(hue)} degrees`} />
}

function AlphaSlider({ color, onChange }: { color: Oklch; onChange: (alpha: number) => void }) {
  const solid = formatOklch({ ...color, a: 1 })
  return (
    <div className="inspector-swatch rounded-full">
      <Track label="Opacity" value={color.a * 100} max={100}
        background={`linear-gradient(to right, transparent, ${solid})`}
        onChange={(v) => onChange(Math.round(v) / 100)} valueText={`${Math.round(color.a * 100)}%`} />
    </div>
  )
}
