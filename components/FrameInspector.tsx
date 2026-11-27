'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { Braces, Camera, Check, ClipboardCheck, Code2, Copy, Download, ExternalLink, FileCode, Frame as FrameIcon, GitBranch, Globe, History, Info, Layers, Link2, MousePointerClick, Palette, PanelTop, PencilRuler, Play, Radio, Route, Scan, Shapes, Trash2, Type } from 'lucide-react'
import { LIVE_FRAMES } from '@/lib/features'
import { deckMembers, frameSourceUrl, pageStart } from '@/lib/ops'
import type { Frame, FramePatch } from '@/lib/types'
import { useFrameActions } from './actions'
import { ChoiceSelect } from './ChoiceSelect'
import { ElementInspector } from './ElementInspector'
import { BuildSection, DriftSection } from './BuildSections'
import { InspectorMenu, InspectorSection, InspectorViews, NumberProperty, PropertyRow, SelectionHeader } from './InspectorUI'
import { IconButton, Kbd, cx } from './kit'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Input } from './ui/input'
import { SIZES, useStudio } from './studio-context'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'

const VersionHistoryDialog = dynamic(() => import('./VersionHistoryDialog').then((module) => module.VersionHistoryDialog))

export function FrameInspector() {
  const { board, selection, interactId, element, openShortcuts } = useStudio()
  if (element && interactId && selection.includes(interactId)) return <ElementInspector key={`${interactId}:${element.path}`} el={element} />
  const frames = selection.map((id) => board.frames.find((frame) => frame.id === id)).filter((frame): frame is Frame => !!frame)
  if (frames.length > 1) return <ManySelected frames={frames} />
  if (frames.length === 1) return <OneFrame key={frames[0]!.deckId ?? frames[0]!.id} frame={frames[0]!} />
  return (
    <div className="flex flex-col items-start gap-2 px-4 py-6">
      <MousePointerClick size={20} aria-hidden className="text-muted-foreground" />
      <h3 className="text-sm font-semibold">Select a frame or layer</h3>
      <p className="text-sm text-muted-foreground">Double-click a frame to edit its contents.</p>
      <Button variant="ghost" size="sm" onClick={openShortcuts}>Keyboard shortcuts <Kbd>?</Kbd></Button>
    </div>
  )
}

function OneFrame({ frame }: { frame: Frame }) {
  const { board, pageId, dispatch, select, interactId, setInteractId, play, hotspots, openCode, openWebsite, openAlternates, prototype } = useStudio()
  const act = useFrameActions()
  const members = frame.deckId ? deckMembers(board, frame.deckId) : []
  const versions = frame.versions?.length ?? 0
  const [historyFrameId, setHistoryFrameId] = useState<string | null>(null)
  const isStart = pageStart(board, pageId) === frame.id
  const links = hotspots[frame.id]?.length ?? 0
  const editing = interactId === frame.id
  const patch = (change: FramePatch) => dispatch({ type: 'frame.update', id: frame.id, patch: change })
  const website = frame.kind === 'website'
  const kind = frame.shape ? frame.shape[0]!.toUpperCase() + frame.shape.slice(1) : website ? 'Website' : frame.kind === 'live' ? 'Live frame' : 'Sketch'
  const FrameType = frame.shape === 'text' ? Type : frame.shape ? Shapes : website ? Globe : frame.kind === 'live' ? Radio : FrameIcon
  const canPrototype = frame.kind === 'sketch' && !frame.shape
  const sourceUrl = website ? frameSourceUrl(frame, board.appUrl) : undefined
  const preset = SIZES.find(({ w, h }) => w === frame.w && h === frame.h)
  const number = (key: 'x' | 'y' | 'w' | 'h', label: string, min = -Infinity) => (
    <NumberProperty label={label} value={String(frame[key])}
      normalize={(value) => Number.isFinite(Number(value)) ? String(Math.max(min, Math.round(Number(value)))) : null}
      onCommit={(value) => patch({ [key]: Number(value) })}
    />
  )

  const layout = (
    <>
      {frame.buildOf && <DriftSection build={frame} />}
      {website && (
        <InspectorSection title="Website" icon={Globe}>
          {sourceUrl && <p className="truncate text-xs text-muted-foreground" title={sourceUrl}>{sourceUrl}</p>}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => openWebsite(frame.id)}><Link2 data-icon="inline-start" aria-hidden /> Edit URL</Button>
            {sourceUrl && <Button size="sm" variant="ghost" onClick={() => act.openInTab(frame)}><ExternalLink data-icon="inline-start" aria-hidden /> Open in browser</Button>}
          </div>
          {sourceUrl && (
            <Button size="sm" variant="secondary" className="self-start" onClick={() => void act.snapshot(frame)}>
              <Camera data-icon="inline-start" aria-hidden /> Snapshot as editable sketch
            </Button>
          )}
        </InspectorSection>
      )}
      <InspectorSection title="Position & size" icon={PanelTop}>
        <div className="grid grid-cols-2 gap-x-2 gap-y-2.5">
          {number('x', 'X')}
          {number('y', 'Y')}
          {number('w', 'Width', frame.shape ? 2 : 160)}
          {number('h', 'Height', frame.shape ? 2 : 120)}
        </div>
        {!frame.shape && (
          <PropertyRow label="Preset">
            <ChoiceSelect label="Frame size preset" value={preset?.label ?? null} placeholder="Custom" className="w-full"
              options={SIZES.map(({ label, w, h }) => ({ value: label, label: `${label} · ${w} × ${h}` }))}
              onChange={(value) => {
                const size = SIZES.find(({ label }) => label === value)
                if (size) patch({ w: size.w, h: size.h })
              }} />
          </PropertyRow>
        )}
      </InspectorSection>
      <InspectorSection title={frame.shape ? 'Layer details' : 'Frame details'} icon={Info}>
        <TextField label="Name" value={frame.name} required onCommit={(name) => patch({ name })} />
        {LIVE_FRAMES && frame.kind === 'live' && <TextField label="Address" value={frame.url ?? ''} onCommit={(url) => patch({ url })} mono />}
        {!frame.shape && !website && (
          <>
            <TextField label="Route" value={frame.route ?? ''} onCommit={(route) => patch({ route })} mono placeholder="/checkout" />
            <TextField label="State" value={frame.state ?? ''} onCommit={(state) => patch({ state })} placeholder="Default" />
          </>
        )}
      </InspectorSection>
    </>
  )

  const variants = (
    <InspectorSection title="Variants" icon={Layers} summary={members.length}>
      <ul className="flex flex-col gap-1">
        {members.map((member, index) => (
          <li key={member.id}>
            <Button variant={member.id === frame.id ? 'secondary' : 'ghost'}
              onClick={() => {
                dispatch({ type: 'deck.front', deckId: frame.deckId!, frameId: member.id })
                select([member.id])
              }}
              aria-pressed={member.id === frame.id}
              className="w-full min-w-0 justify-start"
            >
              <span className="text-xs tabular-nums">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-left">{member.name}</span>
              <span className="max-w-20 truncate text-xs text-muted-foreground">{member.createdBy.name}</span>
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" onClick={() => act.keep(frame)}><Check data-icon="inline-start" aria-hidden /> Keep this variant</Button>
        <Button size="sm" variant="outline" onClick={() => act.compare(frame)}>Compare</Button>
        <Button size="sm" variant="ghost" onClick={() => openAlternates(frame.id)}><GitBranch data-icon="inline-start" aria-hidden /> See as tree</Button>
      </div>
    </InspectorSection>
  )

  const prototypeView = (
    <InspectorSection title="Playback" icon={Route} summary={`${links} ${links === 1 ? 'link' : 'links'}`}>
      <InspectorCheck checked={isStart} onChange={(checked) => dispatch({ type: 'board.update', pageId, flowStart: checked ? frame.id : '' })}>Use as start screen</InspectorCheck>
      <Button size="sm" variant="secondary" onClick={() => play(frame.id)} className="self-start"><Play data-icon="inline-start" aria-hidden /> Play from here</Button>
    </InspectorSection>
  )

  const details = (
    <>
      {!frame.shape && (
        <InspectorSection title="Handoff" icon={ClipboardCheck}>
          {!website && <InspectorCheck checked={!!frame.approved} onChange={(approved) => patch({ approved })}>Ready for development</InspectorCheck>}
          <InspectorCheck checked={!!frame.reference} onChange={(reference) => patch({ reference })}>Pin as design reference</InspectorCheck>
        </InspectorSection>
      )}
      {frame.kind === 'sketch' && !frame.shape && !frame.buildOf && <BuildSection design={frame} />}
      {frame.kind === 'sketch' && (
        <InspectorSection title="Export" icon={Download}>
          <div className="grid grid-cols-3 gap-1.5">
            {[1, 2, 3].map((scale) => <Button key={scale} variant="outline" size="sm" onClick={() => act.exportPng(frame, scale)}>PNG {scale}×</Button>)}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Button variant="outline" size="sm" onClick={() => act.exportHtml(frame)}>HTML</Button>
            <Button variant="outline" size="sm" onClick={() => act.exportPdf(frame)}>PDF</Button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="secondary" size="sm" className="w-full" />}>
              <Code2 data-icon="inline-start" aria-hidden /> Copy as code
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => void act.copyCode(frame, 'html')}><FileCode aria-hidden /> HTML</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void act.copyCode(frame, 'react')}><Code2 aria-hidden /> React component (JSX)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void act.copyCode(frame, 'tokens')}><Palette aria-hidden /> Tokens as CSS variables</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </InspectorSection>
      )}
      {versions > 0 && (
        <InspectorSection title="Version history" icon={History} summary={versions}>
          <Button size="sm" variant="outline" className="self-start" onClick={() => setHistoryFrameId(frame.id)}>Browse versions</Button>
        </InspectorSection>
      )}
    </>
  )

  return (
    <>
      <InspectorViews
        initialView={prototype && canPrototype ? 'prototype' : 'layout'}
        key={`${prototype}:${members.length > 1}`}
        header={
          <SelectionHeader
            name={frame.name}
            detail={<><Badge variant="secondary">{kind}</Badge><span className="tabular-nums">{frame.w} × {frame.h}</span></>}
            icon={<FrameType size={17} strokeWidth={1.75} aria-hidden />}
            actions={
              <>
                <IconButton label="Zoom to frame" keys={['⇧', '2']} onClick={() => act.zoomTo(frame)} className="size-7"><Scan aria-hidden /></IconButton>
                <InspectorMenu label="Frame actions">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => act.variant(frame)}><Layers aria-hidden /> Make a variant</DropdownMenuItem>
                    {frame.kind !== 'website' && !frame.shape && !frame.buildOf && <DropdownMenuItem onClick={() => openAlternates(frame.id)}><GitBranch aria-hidden /> {members.length > 1 ? 'Alternates' : 'Explore alternates'}</DropdownMenuItem>}
                    <DropdownMenuItem onClick={() => act.duplicate(frame)}><Copy aria-hidden /> Duplicate</DropdownMenuItem>
                    {frame.kind === 'sketch' && <DropdownMenuItem onClick={() => openCode(frame.id)}><Braces aria-hidden /> Edit HTML</DropdownMenuItem>}
                    {versions > 0 && <DropdownMenuItem onClick={() => setHistoryFrameId(frame.id)}><History aria-hidden /> Version history</DropdownMenuItem>}
                    {LIVE_FRAMES && frame.kind === 'live' && act.canOpenInTab(frame) && <DropdownMenuItem onClick={() => act.openInTab(frame)}><ExternalLink aria-hidden /> Open in new tab</DropdownMenuItem>}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem variant="destructive" onClick={() => act.remove([frame.id])}><Trash2 aria-hidden /> Delete {frame.shape ? 'layer' : 'frame'}</DropdownMenuItem>
                  </DropdownMenuGroup>
                </InspectorMenu>
              </>
            }
          >
            {(frame.kind !== 'live' || LIVE_FRAMES) && (
              <Button variant="secondary" size="sm" className="w-full" onClick={() => editing ? setInteractId(null) : act.use(frame)}>
                {editing ? <Check data-icon="inline-start" aria-hidden /> : frame.kind !== 'sketch' ? <MousePointerClick data-icon="inline-start" aria-hidden /> : <PencilRuler data-icon="inline-start" aria-hidden />}
                {editing ? (website ? 'Done browsing' : 'Finish editing') : website ? 'Browse website' : frame.kind === 'live' ? 'Use the page' : 'Edit contents'}
              </Button>
            )}
          </SelectionHeader>
        }
        views={[
          { id: 'layout', label: 'Layout', content: layout },
          ...(members.length > 1 ? [{ id: 'variants', label: 'Variants', content: variants }] : []),
          ...(canPrototype ? [{ id: 'prototype', label: 'Prototype', content: prototypeView }] : []),
          { id: 'details', label: 'Details', content: details },
        ]}
      />
      {historyFrameId === frame.id && <VersionHistoryDialog frame={frame} onClose={() => setHistoryFrameId(null)} />}
    </>
  )
}

function ManySelected({ frames }: { frames: Frame[] }) {
  const { openLoupe } = useStudio()
  const act = useFrameActions()
  return (
    <>
      <SelectionHeader name={`${frames.length} layers selected`} detail="Multiple selection" icon={<Layers size={16} aria-hidden />} actions={
        <InspectorMenu label="Selection actions">
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={() => act.remove(frames.map((f) => f.id))}><Trash2 aria-hidden /> Delete selected layers</DropdownMenuItem>
          </DropdownMenuGroup>
        </InspectorMenu>
      }>
        {frames.length === 2 && <Button size="sm" variant="secondary" onClick={() => openLoupe()}>Compare the two <Kbd>L</Kbd></Button>}
      </SelectionHeader>
      <ul className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-3">
        {frames.map((frame) => (
          <li key={frame.id} className="flex min-h-8 min-w-0 items-center gap-2 text-sm">
            <FrameIcon size={13} aria-hidden className="shrink-0 text-muted-foreground" />
            <span className="truncate">{frame.name}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

function InspectorCheck({ checked, onChange, children }: { checked: boolean; onChange: (next: boolean) => void; children: string }) {
  return (
    <label className="flex min-h-8 items-center gap-2.5 rounded-md px-1.5 text-xs hover:bg-muted">
      <Checkbox aria-label={children} checked={checked} onCheckedChange={onChange} />
      {children}
    </label>
  )
}

function TextField({ label, value, onCommit, mono, placeholder, required }: { label: string; value: string; onCommit: (value: string) => void; mono?: boolean; placeholder?: string; required?: boolean }) {
  return (
    <PropertyRow label={label}>
      <Input
        key={value}
        aria-label={label}
        name={label}
        autoComplete="off"
        spellCheck={!mono}
        defaultValue={value}
        placeholder={placeholder}
        onBlur={(event) => {
          const input = event.currentTarget
          const next = input.value.trim()
          if (!next && required) input.value = value
          else if (next !== value) onCommit(next)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          if (event.key === 'Escape') event.currentTarget.value = value
          event.currentTarget.blur()
        }}
        className={cx('w-full min-w-0', mono && 'font-mono text-xs')}
      />
    </PropertyRow>
  )
}
