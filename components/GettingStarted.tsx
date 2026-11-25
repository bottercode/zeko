'use client'

import { useState } from 'react'
import { Columns2, Play, X } from 'lucide-react'
import { deckMembers, visibleFrames } from '@/lib/ops'
import { useStudio } from './studio-context'
import { Button } from './ui/button'

export function GettingStarted({ left }: { left: number }) {
  const { board, pageId, openLoupe, play } = useStudio()
  const [dismissed, setDismissed] = useState(false)
  const [compared, setCompared] = useState(false)
  const variant = visibleFrames(board, pageId).find((frame) => frame.deckId && deckMembers(board, frame.deckId).length > 1)

  if (dismissed || (!variant && !board.flowStart)) return null

  return (
    <section aria-label="Sample canvas guide" className="panel editor-rail rise-in absolute bottom-3 z-10 flex w-[310px] max-w-[calc(100%-2rem)] flex-col gap-3 p-4" style={{ left }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">{compared ? 'Try the checkout flow' : 'Explore the sample'}</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {compared || !variant
              ? 'Play the prototype and follow the links from pricing to checkout.'
              : 'Drag the comparison divider to see what changed between two pricing designs.'}
          </p>
        </div>
        <Button aria-label="Dismiss sample guide" size="icon-xs" variant="ghost" onClick={() => setDismissed(true)}><X aria-hidden /></Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {variant && !compared && <Button size="sm" onClick={() => {
          openLoupe([variant.id])
          setCompared(true)
        }}><Columns2 data-icon="inline-start" aria-hidden /> Compare designs</Button>}
        {board.flowStart && <Button size="sm" variant={compared || !variant ? 'default' : 'outline'} onClick={() => play(board.flowStart)}>
          <Play data-icon="inline-start" aria-hidden /> Play prototype
        </Button>}
      </div>
    </section>
  )
}
