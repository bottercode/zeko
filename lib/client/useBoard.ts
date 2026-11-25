'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { applyOp, inverseOf } from '../ops'
import type { Actor, Board, Op } from '../types'

export const ME: Actor = { kind: 'human', name: 'You' }

export type Connection = 'connecting' | 'live' | 'offline' | 'missing'

/**
 * The board, kept live over server-sent events. Changes apply here at once
 * and are sent to the server, whose next snapshot replaces the local copy.
 */
export function useBoard(boardId: string) {
  const q = `?board=${encodeURIComponent(boardId)}`
  const [board, setBoard] = useState<Board | null>(null)
  const [connection, setConnection] = useState<Connection>('connecting')
  const current = useRef<Board | null>(null)
  const undoStack = useRef<Op[]>([])
  const redoStack = useRef<Op[]>([])
  const [history, setHistory] = useState({ canUndo: false, canRedo: false })

  const show = useCallback((next: Board) => {
    current.current = next
    setBoard(next)
  }, [])
  const syncHistory = () => setHistory({ canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0 })

  useEffect(() => {
    const source = new EventSource(`/api/events${q}`)
    source.onopen = () => setConnection('live')
    source.onerror = () => {
      // An unknown canvas answers 404, which the browser reports only as an error. Ask once to tell them apart.
      void fetch(`/api/board${q}`)
        .then((r) => {
          if (r.status === 404) {
            source.close()
            setConnection('missing')
          } else setConnection('offline')
        })
        .catch(() => setConnection('offline'))
    }
    source.onmessage = (event) => {
      show(JSON.parse(event.data) as Board)
      setConnection('live')
    }
    return () => source.close()
  }, [show, q])

  /** Applies an op here at once, records how to take it back, and sends it to the server. */
  const run = useCallback(
    (op: Op, mode: 'do' | 'undo' | 'redo') => {
      const before = current.current
      if (!before) return
      const after = applyOp(before, op, ME)
      const back = inverseOf(before, after)
      if (back) {
        if (mode === 'undo') redoStack.current.push(back)
        else {
          undoStack.current.push(back)
          if (undoStack.current.length > 200) undoStack.current.shift()
          if (mode === 'do') redoStack.current = []
        }
        syncHistory()
      }
      show(after)
      void fetch(`/api/board${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(op),
      }).then((response) => {
        if (!response.ok) setConnection('offline')
      }).catch(() => setConnection('offline'))
    },
    [show, q],
  )

  const dispatch = useCallback((op: Op) => run(op, 'do'), [run])
  const undo = useCallback(() => {
    const op = undoStack.current.pop()
    if (op) run(op, 'undo')
    syncHistory()
  }, [run])
  const redo = useCallback(() => {
    const op = redoStack.current.pop()
    if (op) run(op, 'redo')
    syncHistory()
  }, [run])

  const reset = useCallback(async () => {
    undoStack.current = []
    redoStack.current = []
    syncHistory()
    await fetch(`/api/board${q}`, { method: 'DELETE' })
  }, [q])

  /** Loads an exported board. Returns an error message, or null when it worked. */
  const importBoard = useCallback(async (json: string): Promise<string | null> => {
    let body: unknown
    try {
      body = JSON.parse(json)
    } catch {
      return 'That file isn’t valid JSON.'
    }
    const res = await fetch(`/api/board${q}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Couldn’t import that board.'
    undoStack.current = []
    redoStack.current = []
    syncHistory()
    return null
  }, [q])

  return { board, dispatch, undo, redo, history, connection, reset, importBoard }
}

/** A clock that re-renders every few seconds, for "away" and "2m ago". */
export function useNow(intervalMs = 5000) {
  // Starts at 0 so the prerendered shell never reads the clock; set on mount.
  const [now, setNow] = useState(0)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, intervalMs)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [intervalMs])
  return now
}

export function newId() {
  return Math.random().toString(36).slice(2, 12)
}

export function ago(at: number, now: number) {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** A stable colour per agent name, picked from a set that reads on the light table. */
const AGENT_COLORS = ['#3B5BDB', '#0C8599', '#7048E8', '#E67700', '#2B8A3E', '#C2255C']
export function agentColor(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AGENT_COLORS[h % AGENT_COLORS.length]!
}
