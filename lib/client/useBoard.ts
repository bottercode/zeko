'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { applyOp, inverseOf } from '../ops'
import type { Actor, Board, Op } from '../types'
import { returnToSignIn } from './sign-in'

export const ME: Actor = { kind: 'human', name: 'You' }

export type Connection = 'connecting' | 'live' | 'offline' | 'missing'
export type SaveState = 'idle' | 'saving' | 'failed'

/**
 * The board, kept live over server-sent events. Changes apply here at once
 * and are sent to the server, whose next snapshot replaces the local copy.
 */
export function useBoard(boardId: string) {
  const q = `?board=${encodeURIComponent(boardId)}`
  const [board, setBoard] = useState<Board | null>(null)
  const [connection, setConnection] = useState<Connection>('connecting')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const current = useRef<Board | null>(null)
  const server = useRef<Board | null>(null)
  const pending = useRef(0)
  const saveFailed = useRef(false)
  const committedVersion = useRef(0)
  const writes = useRef(Promise.resolve())
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
    let request: AbortController | undefined
    let received = false
    const recover = () => {
      if (request) return
      const abort = new AbortController()
      request = abort
      void fetch(`/api/board${q}`, { signal: abort.signal })
        .then(async (r) => {
          if (await returnToSignIn(r)) {
            source.close()
            return
          }
          if (abort.signal.aborted) return
          if (r.status === 404) {
            source.close()
            setConnection('missing')
          } else {
            if (r.ok && !current.current) {
              const snapshot = await r.json() as Board
              if (!abort.signal.aborted && !current.current) show(snapshot)
            }
            if (!abort.signal.aborted) setConnection('offline')
          }
        })
        .catch(() => { if (!abort.signal.aborted) setConnection('offline') })
        .finally(() => { if (request === abort) request = undefined })
    }
    source.onerror = recover
    const fallback = setTimeout(() => { if (!received) recover() }, 800)
    source.onmessage = (event) => {
      try {
        const snapshot = JSON.parse(event.data) as Board
        received = true
        request?.abort()
        server.current = snapshot
        if (!pending.current && snapshot.version >= committedVersion.current) show(snapshot)
        setConnection('live')
      } catch { recover() }
    }
    return () => {
      clearTimeout(fallback)
      request?.abort()
      source.close()
    }
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
      pending.current++
      setSaveState('saving')
      // Keep gestures and text edits in the order the person made them.
      writes.current = writes.current.then(async () => {
        try {
          const response = await fetch(`/api/board${q}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(op),
          })
          if (await returnToSignIn(response)) return
          if (!response.ok) throw new Error('Could not save the canvas change.')
          const { version } = await response.json() as { version: number }
          committedVersion.current = Math.max(committedVersion.current, version)
        } catch {
          saveFailed.current = true
        } finally {
          if (--pending.current === 0) {
            if (server.current && server.current.version >= committedVersion.current) show(server.current)
            setSaveState(saveFailed.current ? 'failed' : 'idle')
          }
        }
      })
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

  /** Loads an exported board. Returns an error message, or null when it worked. */
  const importBoard = useCallback(async (json: string): Promise<string | null> => {
    let body: unknown
    try {
      body = JSON.parse(json)
    } catch {
      return 'That file isn’t valid JSON.'
    }
    await writes.current
    const res = await fetch(`/api/board${q}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    if (!res) return 'Couldn’t reach Zeko to import the canvas. Try again.'
    if (await returnToSignIn(res)) return 'Sign in to import this canvas.'
    if (!res.ok) return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Couldn’t import that board.'
    const snapshot = await fetch(`/api/board${q}`).then((response) => response.ok ? response.json() as Promise<Board> : undefined).catch(() => undefined)
    if (snapshot && (!server.current || snapshot.version >= server.current.version)) show(snapshot)
    saveFailed.current = false
    setSaveState('idle')
    undoStack.current = []
    redoStack.current = []
    syncHistory()
    return null
  }, [q, show])

  return { board, dispatch, undo, redo, history, connection, saveState, importBoard }
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
