'use client'

import { Blend, Component, Italic, Sparkles, Strikethrough, Underline, CaseUpper, Wand2 } from 'lucide-react'
import type { ElementInfo } from '@/lib/client/bridge'
import { FONT_CATEGORIES, FONTS, fontFromStack, fontHref } from '@/lib/fonts'
import { SHADER_PRESETS, isShaderPreset, readShaderParams, shaderAttributes, shaderFallback, shaderLayerHtml, type ShaderParams, type ShaderPreset } from '@/lib/shaders'
import { layerHtml } from '@/lib/client/copy-code'
import { ChoiceSelect } from './ChoiceSelect'
import { InspectorSection, PropertyRow } from './InspectorUI'
import { useStudio } from './studio-context'
import { Button } from './ui/button'
import { Slider } from './ui/slider'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

type Style = (patch: Record<string, string>) => void

/* ---------- Typography additions ---------- */

export function FontFamilyRow({ el, style }: { el: ElementInfo; style: Style }) {
  const { toFrame } = useStudio()
  const current = fontFromStack(el.inline.fontFamily || el.style.fontFamily)
  const custom = current ? null : el.style.fontFamily.split(',')[0]?.replace(/["']/g, '').trim()
  return (
    <PropertyRow label="Font">
      <ChoiceSelect label="Font family" value={current?.family ?? custom ?? null} placeholder="Choose a font…" className="w-full"
        options={[
          ...(custom ? [{ value: custom, label: custom, group: 'In this sketch' }] : []),
          ...FONT_CATEGORIES.flatMap(({ id, label }) => FONTS.filter((font) => font.category === id).map((font) => ({ value: font.family, label: font.family, group: label }))),
        ]}
        onChange={(family) => {
          const font = FONTS.find((item) => item.family === family)
          if (!font) return
          const href = fontHref(font)
          if (href) toFrame({ type: 'ensure-font', href })
          style({ 'font-family': font.stack })
        }} />
    </PropertyRow>
  )
}

export function TextStyleRow({ el, style }: { el: ElementInfo; style: Style }) {
  const lines = el.style.textDecorationLine.split(' ')
  const value = [
    ...(el.style.fontStyle === 'italic' ? ['italic'] : []),
    ...(lines.includes('underline') ? ['underline'] : []),
    ...(lines.includes('line-through') ? ['strike'] : []),
    ...(el.style.textTransform === 'uppercase' ? ['upper'] : []),
  ]
  return (
    <PropertyRow label="Style">
      <ToggleGroup aria-label="Text style" multiple size="sm" variant="outline" spacing={0} className="w-full" value={value}
        onValueChange={(next: string[]) => {
          const decoration = [next.includes('underline') && 'underline', next.includes('strike') && 'line-through'].filter(Boolean).join(' ') || 'none'
          style({
            'font-style': next.includes('italic') ? 'italic' : 'normal',
            'text-decoration-line': decoration,
            'text-transform': next.includes('upper') ? 'uppercase' : 'none',
          })
        }}>
        {([['italic', Italic, 'Italic'], ['underline', Underline, 'Underline'], ['strike', Strikethrough, 'Strikethrough'], ['upper', CaseUpper, 'Uppercase']] as const).map(([id, Icon, label]) => (
          <ToggleGroupItem key={id} value={id} aria-label={label} className="min-w-0 flex-1"><Icon aria-hidden /></ToggleGroupItem>
        ))}
      </ToggleGroup>
    </PropertyRow>
  )
}

/* ---------- Effects: blending, masks and clipping ---------- */

const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']

const MASKS: Record<string, { label: string; value: string }> = {
  none: { label: 'None', value: 'none' },
  'fade-bottom': { label: 'Fade out at the bottom', value: 'linear-gradient(to bottom, #000 55%, transparent)' },
  'fade-top': { label: 'Fade in from the top', value: 'linear-gradient(to top, #000 55%, transparent)' },
  'fade-sides': { label: 'Fade at the sides', value: 'linear-gradient(to right, transparent, #000 18%, #000 82%, transparent)' },
  vignette: { label: 'Vignette', value: 'radial-gradient(closest-side, #000 55%, transparent)' },
  spotlight: { label: 'Spotlight', value: 'radial-gradient(circle at 30% 30%, #000 20%, transparent 70%)' },
}

const CLIPS: Record<string, { label: string; value: string }> = {
  none: { label: 'None', value: 'none' },
  circle: { label: 'Circle', value: 'circle(50% at 50% 50%)' },
  ellipse: { label: 'Ellipse', value: 'ellipse(50% 50% at 50% 50%)' },
  pill: { label: 'Rounded inset', value: 'inset(0 round 999px)' },
  triangle: { label: 'Triangle', value: 'polygon(50% 0%, 100% 100%, 0% 100%)' },
  diamond: { label: 'Diamond', value: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' },
  hexagon: { label: 'Hexagon', value: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)' },
  blob: { label: 'Wave edge', value: 'polygon(0 0, 100% 0, 100% 86%, 75% 92%, 50% 86%, 25% 92%, 0 86%)' },
}

const normalize = (value: string) => value.replace(/\s+/g, '').replace(/rgb\(0,0,0\)/g, '#000').replace(/rgba\(0,0,0,0\)/g, 'transparent').toLowerCase()
const matchPreset = (presets: Record<string, { value: string }>, current: string) => {
  if (!current || current === 'none') return 'none'
  const found = Object.entries(presets).find(([, preset]) => normalize(preset.value) === normalize(current))
  return found?.[0] ?? null
}

export function EffectsSection({ el, style }: { el: ElementInfo; style: Style }) {
  const mask = matchPreset(MASKS, el.style.maskImage)
  const clip = matchPreset(CLIPS, el.style.clipPath)
  return (
    <InspectorSection title="Effects" icon={Blend}>
      <PropertyRow label="Blend">
        <ChoiceSelect label="Blend mode" value={el.style.mixBlendMode || 'normal'} className="w-full"
          options={BLEND_MODES.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1).replace('-', ' ') }))}
          onChange={(value) => style({ 'mix-blend-mode': value })} />
      </PropertyRow>
      <PropertyRow label="Mask">
        <ChoiceSelect label="Mask" value={mask} placeholder="Custom mask" className="w-full"
          options={Object.entries(MASKS).map(([value, { label }]) => ({ value, label }))}
          onChange={(value) => {
            const css = MASKS[value]!.value
            style({ 'mask-image': css, '-webkit-mask-image': css, 'mask-size': '100% 100%', '-webkit-mask-size': '100% 100%' })
          }} />
      </PropertyRow>
      <PropertyRow label="Clip">
        <ChoiceSelect label="Clip shape" value={clip} placeholder="Custom shape" className="w-full"
          options={Object.entries(CLIPS).map(([value, { label }]) => ({ value, label }))}
          onChange={(value) => style({ 'clip-path': CLIPS[value]!.value })} />
      </PropertyRow>
    </InspectorSection>
  )
}

/* ---------- Shader layers ---------- */

export function ShaderSection({ el, ColorRow }: {
  el: ElementInfo
  ColorRow: (props: { label: string; value: string; onCommit: (value: string) => void }) => React.ReactNode
}) {
  const { toFrame } = useStudio()
  const params = readShaderParams(el.shader ?? {})
  const save = (patch: Partial<ShaderParams>) => {
    const next = { ...params, ...patch }
    toFrame({
      type: 'apply', path: el.path,
      attrs: shaderAttributes(next),
      // Keep the stand-in painted under the canvas in step, for exports and screens without WebGL.
      style: { background: shaderFallback(next) },
    })
  }
  const slider = (label: string, key: 'speed' | 'scale' | 'amount' | 'grain', min: number, max: number, step: number, format: (v: number) => string) => (
    <PropertyRow label={label}>
      <div className="flex min-w-0 items-center gap-2">
        <Slider aria-label={label} min={min} max={max} step={step} value={[params[key]]} className="min-w-0 flex-1"
          onValueChange={(value) => save({ [key]: Array.isArray(value) ? value[0] : value })} />
        <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{format(params[key])}</span>
      </div>
    </PropertyRow>
  )
  return (
    <InspectorSection title="Shader" icon={Sparkles}>
      <PropertyRow label="Kind">
        <ChoiceSelect label="Shader kind" value={params.preset} className="w-full"
          options={Object.entries(SHADER_PRESETS).map(([value, { label }]) => ({ value, label }))}
          onChange={(value) => isShaderPreset(value) && save({ preset: value, ...SHADER_PRESETS[value].defaults, colors: params.colors })} />
      </PropertyRow>
      {[0, 1, 2, 3].map((i) => (
        <ColorRow key={i} label={`Color ${i + 1}`} value={params.colors[i] ?? params.colors[i % params.colors.length]!}
          onCommit={(value) => {
            const colors = [0, 1, 2, 3].map((j) => params.colors[j] ?? params.colors[j % params.colors.length]!)
            colors[i] = value
            save({ colors })
          }} />
      ))}
      {slider('Speed', 'speed', 0, 2, 0.05, (v) => (v === 0 ? 'Still' : `${v.toFixed(2)}×`))}
      {slider('Scale', 'scale', 0.25, 4, 0.05, (v) => v.toFixed(2))}
      {slider(params.preset === 'paper' ? 'Texture' : 'Distort', 'amount', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`)}
      {slider('Grain', 'grain', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`)}
      <Button size="sm" variant="outline" className="self-start" onClick={() => save({ seed: Math.round(Math.random() * 999) })}>
        <Wand2 data-icon="inline-start" aria-hidden /> Shuffle
      </Button>
    </InspectorSection>
  )
}

export function newShaderHtml(preset: ShaderPreset = 'mesh') {
  return shaderLayerHtml({ preset, ...SHADER_PRESETS[preset].defaults })
}

/* ---------- Component instances ---------- */

export function InstanceSection({ el }: { el: ElementInfo }) {
  const { board, interactId, editComponent, dispatch, toFrame, toast } = useStudio()
  const instance = el.instance!
  const component = board.components?.find((item) => item.id === instance.id)
  const frame = board.frames.find((item) => item.id === interactId)
  if (frame?.componentId === instance.id) {
    return (
      <InspectorSection title="Main component" icon={Component}>
        <p className="text-xs text-muted-foreground">Changes here reach every instance of {component?.name ?? 'this component'}.</p>
      </InspectorSection>
    )
  }
  const detach = () => toFrame({ type: 'apply', path: instance.path, attrs: { 'data-zeko-instance': '' } })
  return (
    <InspectorSection title="Component instance" icon={Component} summary={component?.name}>
      {component ? (
        <>
          <p className="text-xs text-muted-foreground">Edit the main component to change every instance. Edits made here are replaced on its next change, unless you push them to the main component.</p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => editComponent(component)}>Edit main component</Button>
            <Button size="sm" variant="outline" onClick={() => {
              const root = frame?.html ? layerHtml(frame.html, instance.path) : null
              if (!root) return toast('Couldn’t read this instance. Try again in a moment.')
              dispatch({ type: 'component.update', id: component.id, body: root.outerHTML })
              toast(`Updated ${component.name} everywhere`)
            }}>Push changes to main</Button>
            <Button size="sm" variant="ghost" onClick={detach}>Detach</Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Its main component was removed from the library.</p>
          <Button size="sm" variant="outline" className="self-start" onClick={detach}>Detach</Button>
        </>
      )}
    </InspectorSection>
  )
}

/* ---------- Generation ---------- */
