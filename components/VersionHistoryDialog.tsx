'use client'

import { useState } from 'react'
import { Check, Clock3 } from 'lucide-react'
import { withDesignTokens } from '@/lib/tokens'
import type { Frame } from '@/lib/types'
import { useFrameActions } from './actions'
import { CanvasPreview } from './CanvasPreview'
import { useStudio } from './studio-context'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Separator } from './ui/separator'

export function VersionHistoryDialog({ frame, onClose }: { frame: Frame; onClose: () => void }) {
  const { board } = useStudio()
  const { restoreVersion } = useFrameActions()
  const versions = [...(frame.versions ?? [])].reverse()
  const [selected, setSelected] = useState<number | null>(versions[0]?.at ?? null)
  const version = versions.find(({ at }) => at === selected)
  const format = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const ratio = frame.w / frame.h

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-4xl">
        <DialogHeader className="min-w-0 gap-1 pr-9">
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription className="truncate">{frame.name}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 grid-rows-[minmax(0,8rem)_minmax(0,1fr)] overflow-y-auto rounded-lg border sm:grid-cols-[12rem_minmax(0,1fr)] sm:grid-rows-none">
          <div aria-label="Saved versions" className="flex min-w-0 flex-col gap-1 overflow-y-auto p-2">
            <Button variant={version ? 'ghost' : 'secondary'} aria-pressed={!version} className="w-full justify-start" onClick={() => setSelected(null)}>
              <Check data-icon="inline-start" aria-hidden /> Current version
            </Button>
            {versions.length > 0 && <Separator className="my-1" />}
            {versions.map(({ at, by }) => (
              <Button key={at} variant={at === version?.at ? 'secondary' : 'ghost'} aria-pressed={at === version?.at}
                className="h-auto min-h-11 w-full justify-start px-2.5 py-1.5 text-left" onClick={() => setSelected(at)}>
                <Clock3 data-icon="inline-start" aria-hidden />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate">{by.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{format(at)}</span>
                </span>
              </Button>
            ))}
          </div>
          <div role="region" aria-label="Version preview" className="flex min-h-0 min-w-0 flex-col items-center justify-center gap-2 bg-muted/50 p-3 sm:p-5">
            <div className="w-full overflow-hidden rounded border bg-background"
              style={{ width: `min(100%, max(1rem, (100dvh - 19rem) * ${ratio}))`, aspectRatio: `${frame.w} / ${frame.h}` }}>
              <CanvasPreview cover={{ html: withDesignTokens(version?.html ?? frame.html ?? '', board.design), w: frame.w, h: frame.h }} className="size-full" />
            </div>
            <p aria-live="polite" className="max-w-full truncate text-xs text-muted-foreground">
              {version ? `${version.by.name} · ${format(version.at)}` : 'Current version'}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Done</Button>
          <Button disabled={!version} onClick={() => { if (version) { restoreVersion(frame, version.at); onClose() } }}>
            Restore this version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
