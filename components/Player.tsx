'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, RotateCcw, X } from 'lucide-react'
import { deckFront } from '@/lib/ops'
import type { Board, Frame } from '@/lib/types'
import { withDesignTokens } from '@/lib/tokens'
import { IconButton, Kbd } from './kit'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

/* Runs inside each screen: a click on an element linked with data-zeko-goto
   tells the player where to go. A click anywhere else flashes the links, so
   people can see what is clickable. */
const RUNTIME = String.raw`(() => {
  const style = document.createElement('style')
  style.textContent = 'html.__zeko-hint [data-zeko-goto]{outline:2px solid #5b6cff!important;outline-offset:2px;border-radius:4px;transition:outline-color .2s} [data-zeko-goto]{cursor:pointer}'
  document.head.appendChild(style)
  let t
  addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-zeko-goto]')
    if (el) {
      e.preventDefault()
      e.stopPropagation()
      parent.postMessage({ __zekoPlay: 1, to: el.getAttribute('data-zeko-goto') }, '*')
      return
    }
    if (e.target.closest && e.target.closest('a[href]')) e.preventDefault()
    document.documentElement.classList.add('__zeko-hint')
    clearTimeout(t)
    t = setTimeout(() => document.documentElement.classList.remove('__zeko-hint'), 600)
  }, true)
  addEventListener('submit', (e) => e.preventDefault(), true)
  // The player's keys work with the focus inside a screen too, unless someone is typing.
  addEventListener('keydown', (e) => {
    const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')
    if (e.key === 'Escape' || (!typing && (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'r'))) {
      e.preventDefault()
      parent.postMessage({ __zekoPlay: 1, key: e.key }, '*')
    }
  }, true)
})()`

function withRuntime(html: string) {
  const tag = `<script>${RUNTIME}</script>`
  const i = html.toLowerCase().lastIndexOf('</body>')
  return i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i)
}

/** Click through the board's screens: each link opens the screen it points at. */
export function Player({ board, start, onClose }: { board: Board; start: string; onClose: () => void }) {
  const [stack, setStack] = useState<string[]>([start])
  const [area, setArea] = useState<HTMLDivElement | null>(null)
  const close = useRef<HTMLButtonElement>(null)
  // Keys go to the player, not to a screen or the board: take the focus on open and after each move.
  useEffect(() => {
    close.current?.focus()
  }, [stack])
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  // A link to a variant shows the deck's chosen one.
  const resolve = (id: string): Frame | undefined => {
    const f = board.frames.find((x) => x.id === id)
    return f?.deckId ? (deckFront(board, f.deckId) ?? f) : f
  }
  const current = resolve(stack.at(-1)!)

  useEffect(() => {
    if (!area) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e!.contentRect.width, h: e!.contentRect.height }))
    ro.observe(area)
    return () => ro.disconnect()
  }, [area])

  const stateRef = useRef({ back: () => {}, go: (_to: string) => {}, close: onClose })
  useEffect(() => {
    stateRef.current = {
      back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
      go: (to: string) => {
        if (to === 'back') return setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
        if (resolve(to)) setStack((s) => [...s, to])
      },
      close: onClose,
    }
  })

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return
      const m = e.data as { __zekoPlay?: number; to?: string; key?: string } | null
      if (!m || m.__zekoPlay !== 1) return
      if (m.key === 'Escape') return stateRef.current.close()
      if (m.key === 'ArrowLeft') return stateRef.current.back()
      if (m.key?.toLowerCase() === 'r') return setStack([start])
      if (m.to) stateRef.current.go(m.to)
    }
    // Keys belong to the player while it is open, not to the board underneath.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stateRef.current.close()
      else if (e.key === 'ArrowLeft' || e.key === 'Backspace') stateRef.current.back()
      else if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey) setStack([start])
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('message', onMessage)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [start])

  const scale = current && size.w ? Math.min(1, size.w / current.w, size.h / current.h) : 0

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent fullscreen showCloseButton={false} initialFocus={close} className="bg-background">
        <DialogTitle className="sr-only">Prototype</DialogTitle>
        <div className="flex h-12 shrink-0 items-center gap-2 px-3">
          <IconButton label="Back" keys={['←']} disabled={stack.length < 2} onClick={() => stateRef.current.back()}>
            <ArrowLeft size={16} />
          </IconButton>
          <IconButton label="Restart" keys={['R']} disabled={stack.length < 2} onClick={() => setStack([start])}>
            <RotateCcw size={15} />
          </IconButton>
          <p className="ml-1 min-w-0 flex-1 truncate text-sm">
            {current?.name ?? 'This screen was deleted'}
            <span className="ml-2 text-mist">
              {stack.length > 1 ? `${stack.length} screens in` : 'Click anything linked to move on'}
            </span>
          </p>
          <span className="hidden items-center gap-1.5 text-xs text-mist sm:flex">
            <Kbd>esc</Kbd> to close
          </span>
          <IconButton ref={close} label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div ref={setArea} className="relative min-h-0 flex-1 overflow-hidden">
          {current && scale > 0 && (
            <div
              key={`${current.id}:${stack.length}`}
              className="fade-in absolute top-1/2 left-1/2 overflow-hidden rounded-md bg-white shadow-2xl"
              style={{ width: current.w * scale, height: current.h * scale, transform: 'translate(-50%, -50%)' }}
            >
              <iframe
                ref={frameRef}
                title={current.name}
                srcDoc={withRuntime(withDesignTokens(current.html ?? '', board.design))}
                sandbox="allow-scripts allow-forms"
                className="origin-top-left border-0"
                style={{ width: current.w, height: current.h, transform: `scale(${scale})` }}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
