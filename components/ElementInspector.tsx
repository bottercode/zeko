'use client'

import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowLeft, ArrowUp, Boxes,
  Copy, Image as ImageIcon, MousePointerClick, Palette, PanelTop, Plus, Route,
  Square, Trash2, Type, X,
} from 'lucide-react'
import type { ElementInfo } from '@/lib/client/bridge'
import { useStudio } from './studio-context'
import { IconButton } from './kit'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Checkbox } from './ui/checkbox'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './ui/input-group'
import { ChoiceSelect } from './ChoiceSelect'
import { InspectorMenu, InspectorSection, InspectorViews, NumberProperty, PropertyRow, SelectionHeader } from './InspectorUI'
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator } from './ui/dropdown-menu'

const px = (value: string) => /^-?\d+(\.\d+)?px$/.test(value) ? String(Math.round(parseFloat(value) * 100) / 100) : value
const numeric = /^-?\d+(\.\d+)?$/
const choice = (values: readonly string[], current: string) =>
  [...new Set([...values, ...(current ? [current] : [])])].map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }))

export function ElementInspector({ el }: { el: ElementInfo }) {
  const { toFrame, saveComponent, prototype, board, interactId } = useStudio()
  const frame = board.frames.find((item) => item.id === interactId)
  const colorTokens = board.design?.tokens.filter((token) => token.kind === 'color') ?? []
  const screens = board.frames.filter((item) => item.kind === 'sketch' && !item.shape && item.id !== interactId)
  const style = (patch: Record<string, string>) => toFrame({ type: 'apply', path: el.path, style: patch })
  const attr = (name: string, value: string) => toFrame({ type: 'apply', path: el.path, attrs: { [name]: value } })
  const typographic = el.text !== null || ['button', 'a', 'label', 'li'].includes(el.tag)
  const isFlex = el.style.display.includes('flex')
  const isGrid = el.style.display.includes('grid')
  const hasBorder = !!el.style.borderStyle && el.style.borderStyle !== 'none' && el.style.borderStyle !== 'hidden'
  const clips = [el.style.overflowX, el.style.overflowY].every((value) => value === 'hidden' || value === 'clip')
  const move = (dir: -1 | 1) => toFrame({ type: 'move', path: el.path, dir })

  const styleView = (
    <>
      {(el.text !== null || el.tag === 'img') && (
        <InspectorSection title="Content" icon={el.tag === 'img' ? ImageIcon : Type}>
          {el.text !== null && (
            <Textarea
              key={el.text}
              aria-label="Element text"
              name="element-text"
              defaultValue={el.text}
              rows={Math.min(5, Math.max(2, el.text.split('\n').length))}
              onBlur={(event) => {
                if (event.currentTarget.value !== el.text) toFrame({ type: 'apply', path: el.path, text: event.currentTarget.value })
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') event.currentTarget.blur()
              }}
              className="h-auto resize-y"
            />
          )}
          {el.tag === 'img' && <AttributeField label="Image source" value={el.src ?? ''} onCommit={(value) => attr('src', value)} />}
        </InspectorSection>
      )}

      {typographic && (
        <InspectorSection title="Typography" icon={Type}>
          <AttributeField label="Font family" value={el.style.fontFamily} onCommit={(value) => {
            if (CSS.supports('font-family', value)) style({ 'font-family': value })
          }} />
          <PropertyRow label="Weight">
            <ChoiceSelect label="Font weight" value={el.style.fontWeight} className="w-full"
              options={[...new Set(['300', '400', '500', '600', '700', '800', el.style.fontWeight])].map((value) => ({
                value, label: ({ '300': 'Light', '400': 'Regular', '500': 'Medium', '600': 'Semibold', '700': 'Bold', '800': 'Extra bold' } as Record<string, string>)[value] ?? value,
              }))}
              onChange={(value) => style({ 'font-weight': value })} />
          </PropertyRow>
          <div className="grid grid-cols-3 gap-1.5">
            <CssNumber label="Size" property="font-size" value={el.style.fontSize} onStyle={style} />
            <CssNumber label="Line height" property="line-height" value={el.style.lineHeight} onStyle={style} />
            <CssNumber label="Tracking" property="letter-spacing" value={el.style.letterSpacing} onStyle={style} />
          </div>
          <PropertyRow label="Text align">
            <ToggleGroup aria-label="Text alignment" size="sm" variant="outline" spacing={0} className="w-full"
              value={[el.style.textAlign === 'start' ? 'left' : el.style.textAlign === 'end' ? 'right' : el.style.textAlign]}
              onValueChange={([value]) => { if (value) style({ 'text-align': value }) }}>
              {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight], ['justify', AlignJustify]] as const).map(([value, Icon]) => (
                <ToggleGroupItem key={value} value={value} className="min-w-0 flex-1" aria-label={`Align ${value}`}>
                  <Icon aria-hidden />
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </PropertyRow>
          <ColorRow label="Text color" value={el.style.color} onCommit={(value) => style({ color: value })} />
        </InspectorSection>
      )}

      <InspectorSection title="Appearance" icon={Palette}>
        <ColorRow label="Fill" value={el.style.backgroundColor} onCommit={(value) => style({ 'background-color': value })} clearable />
        {colorTokens.length > 0 && (
          <PropertyRow label="Fill token">
            <ChoiceSelect label="Fill token" placeholder="Choose a color token…" value={null} className="w-full"
              options={colorTokens.map((token) => ({ value: token.name, label: `--${token.name}` }))}
              onChange={(value) => style({ 'background-color': `var(--${value})` })} />
          </PropertyRow>
        )}
        <div className="grid grid-cols-2 gap-2">
          <CssNumber label="Corner radius" property="border-radius" value={el.style.borderRadius} onStyle={style} />
          <NumberProperty label="Opacity" value={String(Math.round(Number(el.style.opacity) * 100))} unit="%"
            normalize={(value) => numeric.test(value) ? String(Math.min(100, Math.max(0, Number(value)))) : null}
            onCommit={(value) => style({ opacity: String(Number(value) / 100) })} />
        </div>
      </InspectorSection>

      <InspectorSection title="Border" icon={Square}>
        <PropertyRow label="Style">
          <ChoiceSelect label="Border style" value={el.style.borderStyle} className="w-full"
            options={choice(['none', 'solid', 'dashed', 'dotted', 'double'], el.style.borderStyle)}
            onChange={(value) => style({ 'border-style': value })} />
        </PropertyRow>
        {hasBorder && (
          <>
            <CssNumber label="Border width" property="border-width" value={el.style.borderWidth} onStyle={style} />
            <ColorRow label="Border color" value={el.style.borderColor} onCommit={(value) => style({ 'border-color': value })} />
          </>
        )}
      </InspectorSection>
    </>
  )

  const layoutView = (
    <>
      <InspectorSection title="Dimensions" icon={PanelTop}>
        <div className="grid grid-cols-2 gap-2">
          <CssNumber label="Width" property="width" value={el.style.width} onStyle={style} />
          <CssNumber label="Height" property="height" value={el.style.height} onStyle={style} />
        </div>
        <PropertyRow label="Position">
          <ChoiceSelect label="Position" value={el.style.position} className="w-full"
            options={choice(['static', 'relative', 'absolute', 'fixed', 'sticky'], el.style.position)}
            onChange={(value) => style({ position: value })} />
        </PropertyRow>
      </InspectorSection>
      <InspectorSection title="Layout" icon={Boxes}>
        <PropertyRow label="Display">
          <ChoiceSelect label="Display" value={el.style.display} className="w-full"
            options={choice(['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid'], el.style.display)}
            onChange={(value) => style({ display: value })} />
        </PropertyRow>
        {isFlex && (
          <PropertyRow label="Direction">
            <ChoiceSelect label="Flex direction" value={el.style.flexDirection} className="w-full"
              options={choice(['row', 'column', 'row-reverse', 'column-reverse'], el.style.flexDirection)}
              onChange={(value) => style({ 'flex-direction': value })} />
          </PropertyRow>
        )}
        {(isFlex || isGrid) && (
          <>
            <PropertyRow label="Align">
              <ChoiceSelect label="Align items" value={el.style.alignItems} className="w-full"
                options={choice(['start', 'center', 'end', 'stretch', 'baseline'], el.style.alignItems)}
                onChange={(value) => style({ 'align-items': value })} />
            </PropertyRow>
            <PropertyRow label="Justify">
              <ChoiceSelect label="Justify content" value={el.style.justifyContent} className="w-full"
                options={choice(['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly'], el.style.justifyContent)}
                onChange={(value) => style({ 'justify-content': value })} />
            </PropertyRow>
            <CssNumber label="Gap" property="gap" value={el.style.gap === 'normal' ? '0' : el.style.gap} onStyle={style} />
          </>
        )}
        <label className="flex min-h-8 items-center gap-2.5 rounded-md px-1.5 text-xs hover:bg-muted">
          <Checkbox aria-label="Clip content" checked={clips} onCheckedChange={(checked) => style({ overflow: checked ? 'hidden' : 'visible' })} />
          Clip content
        </label>
      </InspectorSection>
      <InspectorSection title="Padding" icon={Square}>
        <div className="grid grid-cols-2 gap-2">
          <CssNumber label="Top" property="padding-top" value={el.style.paddingTop} onStyle={style} />
          <CssNumber label="Right" property="padding-right" value={el.style.paddingRight} onStyle={style} />
          <CssNumber label="Bottom" property="padding-bottom" value={el.style.paddingBottom} onStyle={style} />
          <CssNumber label="Left" property="padding-left" value={el.style.paddingLeft} onStyle={style} />
        </div>
      </InspectorSection>
    </>
  )

  const actionsView = (
    <>
      <InspectorSection title="Prototype link" icon={Route}>
        <PropertyRow label="On click">
          <ChoiceSelect label="On click" value={el.goto ?? ''} className="w-full"
            options={[
              { value: '', label: 'Nothing' },
              { value: 'back', label: 'Go back' },
              ...screens.map((item) => ({ value: item.id, label: item.name, group: 'Go to' })),
            ]}
            onChange={(value) => attr('data-zeko-goto', value)} />
        </PropertyRow>
        {el.tag === 'a' && <AttributeField label="Link URL" value={el.href ?? ''} onCommit={(value) => attr('href', value)} />}
      </InspectorSection>

      <InspectorSection title="Insert" icon={Plus}>
        <div className="grid grid-cols-2 gap-1.5">
          {([
            ['text', 'Text', Type],
            ['box', 'Box', Square],
            ['button', 'Button', MousePointerClick],
            ['image', 'Image', ImageIcon],
          ] as const).map(([kind, label, Icon]) => (
            <Button variant="outline" size="sm" className="justify-start" key={kind}
              onClick={() => toFrame({ type: 'insert', path: el.path, kind })}>
              <Icon data-icon="inline-start" aria-hidden /> {label}
            </Button>
          ))}
        </div>
      </InspectorSection>
    </>
  )

  return (
    <InspectorViews initialView={prototype ? 'actions' : typographic || el.tag === 'img' ? 'style' : 'layout'} key={String(prototype)}
      header={
        <SelectionHeader
          name={el.name}
          detail={<><Badge variant="secondary" className="font-mono">&lt;{el.tag}&gt;</Badge><span className="tabular-nums">{el.rect.w} × {el.rect.h}</span></>}
          icon={
            <IconButton label="Back to the frame" onClick={() => toFrame({ type: 'select', path: null })}><ArrowLeft aria-hidden /></IconButton>
          }
          actions={
            <InspectorMenu label="Element actions">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => saveComponent(el.path)}><Boxes aria-hidden /> Save as component</DropdownMenuItem>
                <DropdownMenuItem onClick={() => move(-1)}><ArrowUp aria-hidden /> Move up</DropdownMenuItem>
                <DropdownMenuItem onClick={() => move(1)}><ArrowDown aria-hidden /> Move down</DropdownMenuItem>
                <DropdownMenuItem onClick={() => toFrame({ type: 'duplicate', path: el.path })}><Copy aria-hidden /> Duplicate</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem variant="destructive" onClick={() => toFrame({ type: 'remove', path: el.path })}><Trash2 aria-hidden /> Delete element</DropdownMenuItem>
              </DropdownMenuGroup>
            </InspectorMenu>
          }
        >
          {frame && <span className="min-w-0 truncate text-xs text-muted-foreground" title={frame.name}>{frame.name}</span>}
        </SelectionHeader>
      }
      views={[
        { id: 'style', label: 'Style', content: styleView },
        { id: 'layout', label: 'Layout', content: layoutView },
        { id: 'actions', label: 'Actions', content: actionsView },
      ]}
    />
  )
}

function CssNumber({ label, property, value = '', onStyle }: { label: string; property: string; value: string; onStyle: (patch: Record<string, string>) => void }) {
  return (
    <NumberProperty label={label} value={px(value)} unit={value.endsWith('px') && !value.includes(' ') ? 'px' : ''} allowCss
      normalize={(raw) => {
        const formatted = numeric.test(raw) ? `${raw}px` : raw
        return CSS.supports(property, formatted) ? formatted : null
      }}
      onCommit={(next) => onStyle({ [property]: next })}
    />
  )
}

function AttributeField({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  return (
    <PropertyRow label={label}>
      <Input aria-label={label} name={label} key={value} defaultValue={value}
        autoComplete="off" spellCheck={false} className="w-full min-w-0"
        onBlur={(event) => {
          const next = event.currentTarget.value.trim()
          if (next !== value) onCommit(next)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== 'Escape') return
          event.preventDefault()
          if (event.key === 'Escape') event.currentTarget.value = value
          event.currentTarget.blur()
        }}
      />
    </PropertyRow>
  )
}

function ColorRow({ label, value = '', onCommit, clearable }: { label: string; value: string; onCommit: (value: string) => void; clearable?: boolean }) {
  const rgba = value.match(/rgba?\(([^)]+)\)/)?.[1]?.split(/[\s,/]+/).filter(Boolean)
  const alpha = rgba?.[3] === undefined ? 1 : Number(rgba[3])
  const hex = rgba?.length && rgba.length >= 3
    ? '#' + rgba.slice(0, 3).map((channel) => Math.round(Number(channel)).toString(16).padStart(2, '0')).join('')
    : /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'
  const transparent = value === 'transparent' || alpha === 0
  const display = transparent ? '' : rgba && alpha === 1 ? hex : value
  return (
    <PropertyRow label={label}>
      <InputGroup>
        <InputGroupAddon>
          <label className="inspector-swatch relative size-5 overflow-hidden rounded-sm border border-input focus-within:ring-1 focus-within:ring-ring"
            style={transparent ? undefined : { background: value }}>
            <input type="color" aria-label={`Choose ${label.toLowerCase()}`} value={hex}
              onChange={(event) => onCommit(event.currentTarget.value)}
              className="absolute inset-0 size-full cursor-pointer opacity-0" />
          </label>
        </InputGroupAddon>
        <InputGroupInput aria-label={`${label} value`} name={label} key={display} defaultValue={display} placeholder="None"
          spellCheck={false} autoComplete="off" className="min-w-0 font-mono text-xs"
          onBlur={(event) => {
            const input = event.currentTarget
            const next = input.value.trim()
            if (next === display) return
            if (!next && clearable) onCommit('transparent')
            else if (CSS.supports('color', next)) onCommit(next)
            else input.value = display
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== 'Escape') return
            event.preventDefault()
            if (event.key === 'Escape') event.currentTarget.value = display
            event.currentTarget.blur()
          }}
        />
        {clearable && !transparent && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onCommit('transparent')}><X aria-hidden /></InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
    </PropertyRow>
  )
}
