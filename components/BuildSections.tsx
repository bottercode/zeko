'use client'

import { useState } from 'react'
import {
  CircleCheck, Columns2, Hammer, LetterText, Loader2, Minus, Palette, Plus, RefreshCw, Ruler, Send, SwatchBook, Type, type LucideIcon,
} from 'lucide-react'
import { openDrift } from '@/lib/drift'
import { ago } from '@/lib/client/useBoard'
import type { DriftKind, Frame } from '@/lib/types'
import { useFrameActions } from './actions'
import { InspectorSection } from './InspectorUI'
import { cx } from './kit'
import { useCameraZoom, useStudio } from './studio-context'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Input } from './ui/input'

const KIND: Record<DriftKind, { icon: LucideIcon; name: string }> = {
  missing: { icon: Minus, name: 'Missing' },
  extra: { icon: Plus, name: 'Extra' },
  text: { icon: LetterText, name: 'Copy' },
  spacing: { icon: Ruler, name: 'Spacing' },
  size: { icon: Ruler, name: 'Size' },
  type: { icon: Type, name: 'Type' },
  token: { icon: SwatchBook, name: 'Token' },
  color: { icon: Palette, name: 'Color' },
}

/** The builds of a frame, open differences first counted. */
export function buildsOf(frames: Frame[], design: Frame) {
  return frames.filter((f) => f.buildOf === design.id)
}

/** On a design sketch: capture its implementation, or ask the agent to build it. */
export function BuildSection({ design }: { design: Frame }) {
  const { board } = useStudio()
  const act = useFrameActions()
  const builds = buildsOf(board.frames, design)
  const suggested = builds.at(-1)?.buildUrl ?? `${(board.appUrl || 'http://localhost:3000').replace(/\/$/, '')}${design.route ?? '/'}`
  const [url, setUrl] = useState(suggested)
  const [busy, setBusy] = useState(false)
  const capture = async () => {
    if (!url.trim() || busy) return
    setBusy(true)
    await act.checkBuild({ design, url: url.trim() })
    setBusy(false)
  }
  return (
    <InspectorSection title="Build" icon={Hammer} summary={builds.length ? `${builds.length} ${builds.length === 1 ? 'build' : 'builds'}` : undefined}>
      <p className="text-xs text-muted-foreground">Capture the page that implements this design to see where it differs.</p>
      <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void capture() }}>
        <Input aria-label="Address of the build" value={url} onChange={(e) => setUrl(e.currentTarget.value)} placeholder="http://localhost:3000/pricing" spellCheck={false} className="h-8 font-mono text-xs" />
        <Button type="submit" size="sm" variant="secondary" disabled={!url.trim() || busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : 'Check'}
        </Button>
      </form>
      <Button size="sm" variant="outline" className="self-start" onClick={() => act.buildIt(design)}>
        <Send data-icon="inline-start" aria-hidden /> Build it with your agent
      </Button>
      {builds.map((build) => <BuildRow key={build.id} build={build} />)}
    </InspectorSection>
  )
}

function BuildRow({ build }: { build: Frame }) {
  const { select, flyTo } = useStudio()
  const open = openDrift(build.drift?.items, build.driftAccepted).length
  return (
    <button type="button" onClick={() => { select([build.id]); flyTo(build) }}
      className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-muted">
      <DriftDot open={open} checked={!!build.drift} />
      <span className="min-w-0 flex-1 truncate">{build.buildUrl ?? build.name}</span>
      <span className="shrink-0 text-muted-foreground tabular-nums">{!build.drift ? 'Not checked' : open ? `${open} open` : 'Matches'}</span>
    </button>
  )
}

function DriftDot({ open, checked }: { open: number; checked: boolean }) {
  return <span aria-hidden className={cx('size-2 shrink-0 rounded-full', !checked ? 'bg-mist' : open ? 'bg-amber-500' : 'bg-emerald-500')} />
}

/** On a build: how it differs from its design, with what to do about it. */
export function DriftSection({ build }: { build: Frame }) {
  const { board, now } = useStudio()
  const act = useFrameActions()
  const [busy, setBusy] = useState(false)
  const design = board.frames.find((f) => f.id === build.buildOf)
  const report = build.drift
  const accepted = new Set(build.driftAccepted ?? [])
  const open = openDrift(report?.items, build.driftAccepted)
  const stale = !!report && !!design && design.updatedAt > report.designAt
  const recheck = async () => {
    setBusy(true)
    await act.checkBuild({ build })
    setBusy(false)
  }
  return (
    <InspectorSection title="Drift from design" icon={Ruler} summary={report ? (open.length ? `${open.length} open` : 'Matches') : undefined}>
      {!design ? (
        <p className="text-xs text-muted-foreground">The design this build was compared with is gone.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Built from <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => act.zoomTo(design)}>{design.name}</button>
            {report && <> · checked {ago(report.checkedAt, now)}</>}
          </p>
          {stale && <p className="text-xs text-amber-500">The design changed since this check.</p>}
          {report && !open.length && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-500">
              <CircleCheck size={14} aria-hidden />
              {report.matched < 3 ? 'Few elements matched. Is this the page for this design?' : `Matches the design${accepted.size ? `, with ${accepted.size} accepted ${accepted.size === 1 ? 'difference' : 'differences'}` : ''}.`}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void recheck()}>
              {busy ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : <RefreshCw data-icon="inline-start" aria-hidden />}
              {build.buildUrl ? 'Capture again' : 'Check again'}
            </Button>
            {open.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => act.sendDriftFixes(build)}><Send data-icon="inline-start" aria-hidden /> Send fixes to agent</Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => act.compareWithDesign(build)}><Columns2 data-icon="inline-start" aria-hidden /> Compare</Button>
          </div>
        </>
      )}
      {report && report.items.length > 0 && (
        <ol className="flex flex-col gap-1" aria-label="Differences from the design">
          {report.items.map((item) => {
            const Icon = KIND[item.kind].icon
            const ok = accepted.has(item.key)
            const n = open.indexOf(item) + 1
            return (
              <li key={item.key} className={cx('flex gap-2 rounded-md border border-hair px-2 py-1.5', ok && 'opacity-55')}>
                <span className={cx('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-semibold tabular-nums', ok ? 'bg-muted text-muted-foreground' : 'bg-amber-500 text-black')}>
                  {ok ? '✓' : n}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-1 text-xs font-medium"><Icon size={12} aria-hidden className="shrink-0 text-muted-foreground" /><span className="min-w-0 truncate" title={item.label}>{item.label}</span></span>
                  <span className="grid grid-cols-[auto_1fr] gap-x-1.5 text-2xs text-muted-foreground">
                    <span>Design</span><span className="truncate font-mono" title={item.design}>{item.design}</span>
                    <span>Build</span><span className="truncate font-mono" title={item.build}>{item.build}</span>
                  </span>
                  <label className="mt-0.5 flex items-center gap-1.5 text-2xs text-muted-foreground">
                    <Checkbox checked={ok} onCheckedChange={(checked) => act.acceptDrift(build, item.key, checked === true)} aria-label={`Accept “${item.label}” as intentional`} />
                    Intentional
                  </label>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </InspectorSection>
  )
}

/** Numbered pins on a build frame, one per open difference, drawn at screen size. */
export function DriftPins({ frame }: { frame: Frame }) {
  const { selection } = useStudio()
  const k = 1 / useCameraZoom()
  if (!frame.buildOf || !frame.drift || !selection.includes(frame.id)) return null
  const open = openDrift(frame.drift.items, frame.driftAccepted)
  return (
    <>
      {open.map((item, i) => (
        <div key={item.key} className="pointer-events-none absolute z-10 origin-top-left" style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, transform: `scale(${k})` }}>
          <span title={`${item.label}: ${item.design} → ${item.build}`}
            className="pointer-events-auto grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-amber-500 text-[10px] font-semibold text-black shadow-pop ring-2 ring-white/90 tabular-nums">
            {i + 1}
          </span>
        </div>
      ))}
    </>
  )
}

/** A small status beside a build frame's name. */
export function DriftBadge({ frame }: { frame: Frame }) {
  if (!frame.buildOf) return null
  const open = openDrift(frame.drift?.items, frame.driftAccepted).length
  return (
    <span className={cx('flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-2xs font-medium',
      !frame.drift ? 'bg-wash text-slate' : open ? 'bg-amber-500/15 text-amber-500' : 'bg-emerald-500/15 text-emerald-500')}>
      {!frame.drift ? 'Build' : open ? `Drift ${open}` : <><CircleCheck size={11} aria-hidden /> Matches</>}
    </span>
  )
}
