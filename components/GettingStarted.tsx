'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { visibleFrames } from '@/lib/ops'
import { useStudio } from './studio-context'
import { Button, Kbd, cx } from './kit'

const KEY = 'zeko.getting-started'
type Step = 'flip' | 'compare' | 'connect' | 'request'

interface Saved {
  dismissed: boolean
  done: Step[]
}

function load(): Saved {
  try {
    return { dismissed: false, done: [], ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { dismissed: false, done: [] }
  }
}

/** Lets any part of the studio tick a step off without passing state around. */
export function markStep(step: Step) {
  window.dispatchEvent(new CustomEvent('zeko:step', { detail: step }))
}

/** A short checklist that teaches the board by using it. Rendered only in the browser. */
export function GettingStarted({ left }: { left: number }) {
  const { board, pageId, openConnect } = useStudio()
  const [saved, setSaved] = useState<Saved>(load)
  const previousDecks = useRef(board.decks)

  const save = (next: Saved) => {
    setSaved(next)
    localStorage.setItem(KEY, JSON.stringify(next))
  }
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })

  useEffect(() => {
    const on = (e: Event) => {
      const step = (e as CustomEvent<Step>).detail
      setSaved((cur) => {
        if (cur.done.includes(step)) return cur
        const next = { ...cur, done: [...cur.done, step] }
        localStorage.setItem(KEY, JSON.stringify(next))
        return next
      })
    }
    window.addEventListener('zeko:step', on)
    return () => window.removeEventListener('zeko:step', on)
  }, [])

  // Checked when the front of an existing deck changes.
  useEffect(() => {
    const previous = previousDecks.current
    if (Object.entries(board.decks).some(([id, deck]) => previous[id] && previous[id].front !== deck.front)) markStep('flip')
    previousDecks.current = board.decks
  }, [board.decks])

  const done = new Set<Step>(saved.done)
  if (Object.keys(board.agents).length > 0) done.add('connect')
  if (board.tasks.length > 0) done.add('request')

  const screens = visibleFrames(board, pageId).filter((frame) => !frame.shape)
  const hasDeck = screens.some((frame) => frame.deckId)
  const checklist: { id: Step; title: string; body: React.ReactNode; action?: React.ReactNode }[] = [
    {
      id: 'flip',
      title: 'Flip through a deck',
      body: (
        <>
          Select a stacked frame, then press{' '}
          <span className="whitespace-nowrap">
            <Kbd>←</Kbd> <Kbd>→</Kbd>
          </span>
        </>
      ),
    },
    {
      id: 'compare',
      title: hasDeck ? 'Compare two variants' : 'Compare two screens',
      body: (
        <>
          {hasDeck ? 'Select a deck' : 'Shift-click two screens'}, then press <Kbd>L</Kbd> and drag the divider.
        </>
      ),
    },
    {
      id: 'connect',
      title: 'Use Zeko from an external tool',
      body: 'Connect Claude Code, Codex, Cursor or another MCP client to this canvas.',
      action: (
        <Button size="sm" onClick={openConnect}>
          MCP connection
        </Button>
      ),
    },
    {
      id: 'request',
      title: screens.length ? 'Ask for a redesign' : 'Send a design brief',
      body: screens.length
        ? 'Select a frame and describe the change in the Agents panel.'
        : 'Describe what you’d like to design in the Agents panel.',
    },
  ]
  const steps = checklist.filter(({ id }) => {
    if (id === 'flip') return hasDeck
    if (id === 'compare') return hasDeck || screens.length > 1
    return true
  })
  const next = steps.find((s) => !done.has(s.id))
  const count = steps.filter((s) => done.has(s.id)).length

  if (saved.dismissed) return null

  return (
    <section aria-label="Getting started" className="panel editor-rail rise-in absolute bottom-2 z-10 w-[300px] px-3.5 pt-3 pb-2.5" style={{ left }}>
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold">
          {next ? 'Getting started' : 'You’re set'}
          <span className="ml-1.5 font-normal text-mist tabular-nums">
            {count}/{steps.length}
          </span>
        </h2>
        <button
          aria-label="Hide getting started"
          onClick={() => saveRef.current({ ...saved, dismissed: true })}
          className="grid size-6 place-items-center rounded-md text-mist hover:bg-wash hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>
      <div className="mt-2 flex gap-1" aria-label={`${count} of ${steps.length} done`}>
        {steps.map((s) => (
          <span key={s.id} className={cx('h-1 flex-1 rounded-full transition-colors duration-300', done.has(s.id) ? 'bg-grease' : 'bg-wash')} />
        ))}
      </div>
      <ol className="mt-2 space-y-px">
        {steps.map((s) => {
          const isDone = done.has(s.id)
          const isNext = s.id === next?.id
          return (
            <li key={s.id} className={cx('flex gap-2 rounded-md px-1 py-1', isNext && 'bg-white/[0.03]')}>
              <span
                className={cx(
                  'mt-px grid size-4 shrink-0 place-items-center rounded-full transition-colors',
                  isDone ? 'bg-grease text-white' : 'shadow-[inset_0_0_0_1.5px_var(--color-mist)]',
                )}
              >
                {isDone && <Check size={10} strokeWidth={3} />}
              </span>
              <div className="min-w-0">
                <p className={cx('text-xs leading-4', isDone ? 'text-mist line-through decoration-mist/60' : isNext ? 'font-medium' : 'text-slate')}>{s.title}</p>
                {isNext && (
                  <>
                    <p className="mt-1 text-xs leading-relaxed text-slate">{s.body}</p>
                    {s.action && <div className="mt-2">{s.action}</div>}
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {!next && <p className="mt-1.5 text-xs text-slate">That’s the whole loop. Press ? any time for shortcuts.</p>}
    </section>
  )
}
