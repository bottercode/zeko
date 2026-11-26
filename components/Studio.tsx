'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { boardPages, deckMembers, framePage, pageStart, parseWebsiteUrl, taskResultFrames, visibleFrames } from '@/lib/ops'
import { newId, useBoard, useNow } from '@/lib/client/useBoard'
import { imageSketch, isBoardImage } from '@/lib/client/images'
import { createCamera, INITIAL_CAMERA, type Camera } from '@/lib/client/camera'
import { createFrameGesture } from '@/lib/client/frame-gesture'
import { frameIdOf, noteBridgeHtml, sendToFrame, type ElementInfo, type Hotspot, type LayerNode, type ToFrame } from '@/lib/client/bridge'
import type { Frame, Op, SketchComponent } from '@/lib/types'
import { LIVE_FRAMES } from '@/lib/features'
import { Canvas, ZoomPill } from './Canvas'
import { GettingStarted } from './GettingStarted'
import { LeftPanel } from './LeftPanel'
import { DesignPanel, SidePanel } from './SidePanel'
import { Mark } from './Mark'
import { TopBar } from './TopBar'
import { ConfirmDialog, Menu, ToastProvider, useToast, type MenuItem } from './kit'
import { useFrameActions } from './actions'
import { CHROME, LEFT_PANEL_WIDTH, SIDE_PANEL, StudioContext, useStudio, type Box, type Draft, type StudioState, type Tool } from './studio-context'

const Loupe = dynamic(() => import('./Loupe').then((module) => module.Loupe))
const Player = dynamic(() => import('./Player').then((module) => module.Player))
const SearchDialog = dynamic(() => import('./SearchDialog').then((module) => module.SearchDialog))
const ShortcutsDialog = dynamic(() => import('./Shortcuts').then((module) => module.ShortcutsDialog))
const SketchCodeDialog = dynamic(() => import('./SketchCodeDialog').then((module) => module.SketchCodeDialog))
const WebsiteDialog = dynamic(() => import('./WebsiteDialog').then((module) => module.WebsiteDialog))

const BLANK_SKETCH = `<!doctype html><html><head><style>
  body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;display:grid;place-items:center;height:100vh;background:#fff;color:#68717b}
</style></head><body><p>Empty sketch. Edit its HTML from the frame menu, or ask an agent to fill it.</p></body></html>`

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const SIDE_PANEL_WIDTH_KEY = 'zeko.side-panel-width'
const DESIGN_PANEL_WIDTH = 308

function subscribeToViewport(onResize: () => void) {
  window.addEventListener('resize', onResize)
  return () => window.removeEventListener('resize', onResize)
}

const viewportWidth = () => window.innerWidth
const serverViewportWidth = () => 0

function savedSidePanelWidth() {
  try {
    return Number(window.localStorage.getItem(SIDE_PANEL_WIDTH_KEY)) || SIDE_PANEL.defaultWidth
  } catch {
    return SIDE_PANEL.defaultWidth
  }
}

type StudioProps = { boardId: string; sampleGuide?: boolean; firstCanvas?: boolean }

export function Studio({ boardId, sampleGuide, firstCanvas }: StudioProps) {
  return (
    <ToastProvider>
      <StudioInner key={boardId} boardId={boardId} sampleGuide={sampleGuide} firstCanvas={firstCanvas} />
    </ToastProvider>
  )
}

interface ConfirmState {
  title: string
  body: string
  confirm: string
  returnFocus?: React.RefObject<HTMLElement | null>
  onConfirm: () => void
}

function StudioInner({ boardId, sampleGuide, firstCanvas }: StudioProps) {
  const { board, dispatch, undo, redo, history, connection, saveState, importBoard } = useBoard(boardId)
  const now = useNow()
  const toast = useToast()
  const stageRef = useRef<HTMLDivElement>(null)
  const [leftPreference, setLeftClosed] = useState<boolean>()
  const [panelPreference, setPanelClosed] = useState<boolean>()
  const [agentPanelRequest, setAgentPanelRequest] = useState(0)
  const [preferredPanelWidth, setPreferredPanelWidth] = useState(savedSidePanelWidth)
  const viewport = useSyncExternalStore(subscribeToViewport, viewportWidth, serverViewportWidth)
  const leftClosed = leftPreference ?? (firstCanvas || viewport < 768)
  const panelClosed = panelPreference ?? (firstCanvas || viewport < 900)
  const railLeft = leftClosed ? 8 : LEFT_PANEL_WIDTH + 16
  const leftInset = railLeft + 56
  const maxPanelWidth = Math.max(SIDE_PANEL.minWidth, Math.min(SIDE_PANEL.maxWidth, viewport - leftInset - 200))
  const panelWidth = Math.max(SIDE_PANEL.minWidth, Math.min(maxPanelWidth, preferredPanelWidth))

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDE_PANEL_WIDTH_KEY, String(preferredPanelWidth))
    } catch {
      // Resizing still works when browser storage is unavailable.
    }
  }, [preferredPanelWidth])

  const resizePanel = (width: number) => {
    setPreferredPanelWidth(Math.max(SIDE_PANEL.minWidth, Math.min(maxPanelWidth, Math.round(width))))
  }

  const [selection, setSelection] = useState<string[]>([])
  const [requestedPageId, setRequestedPageId] = useState('')
  const pages = board ? boardPages(board) : []
  const pageId = (pages.find((page) => page.id === requestedPageId) ?? pages[0])?.id ?? ''
  const activePage = useRef(pageId)
  useEffect(() => {
    activePage.current = pageId
  }, [pageId])
  const [tool, setToolState] = useState<Tool>('select')
  const [prototype, setPrototype] = useState(false)
  const [hotspots, setHotspots] = useState<Record<string, Hotspot[]>>({})
  const [playing, setPlaying] = useState<string | null>(null)
  const playerOpen = playing !== null
  const [camera] = useState(createCamera)
  const [frameGesture] = useState(createFrameGesture)
  const [interactId, setInteractId] = useState<string | null>(null)
  const [layers, setLayers] = useState<LayerNode[] | null>(null)
  const [pickedElement, setPickedElement] = useState<{ frameId: string; info: ElementInfo } | null>(null)
  const element = pickedElement?.frameId === interactId ? pickedElement.info : null
  const [designPreference, setDesignPreference] = useState<{ selectionKey: string; open: boolean } | null>(null)
  const selectionKey = JSON.stringify([selection, interactId, element?.path])
  if (designPreference && designPreference.selectionKey !== selectionKey) setDesignPreference(null)
  const designRight = panelClosed ? 56 : panelWidth + 18
  const designFitsBesideAgents = viewport >= designRight + DESIGN_PANEL_WIDTH + 8
  const designFitsCanvas = viewport >= leftInset + designRight + DESIGN_PANEL_WIDTH + 180
  const designOpen = selection.length > 0 && (designPreference?.selectionKey === selectionKey ? designPreference.open : designFitsCanvas)
  const designOffset = designOpen ? (designFitsBesideAgents ? designRight : 8) : Math.min(designRight, Math.max(8, viewport - 48))
  const designInset = designOpen && designFitsCanvas ? DESIGN_PANEL_WIDTH + 10 : 0
  const panelControlsOffset = (panelClosed ? 8 : panelWidth + 16) + designInset
  const rightInset = (panelClosed ? 56 : panelWidth + 20) + designInset
  const [draft, setDraft] = useState<Draft | null>(null)
  const [thread, setThread] = useState<{ id: string; location: 'canvas' | 'panel' } | null>(null)
  const openThread = thread?.id ?? null
  const threadInPanel = thread?.location === 'panel'
  const setOpenThread = useCallback((id: string | null, location: 'canvas' | 'panel' = 'canvas') => {
    setThread(id ? { id, location } : null)
  }, [])
  const [loupe, setLoupe] = useState<[string, string] | null>(null)
  const [connectOpen, setConnectOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [codeFrameId, setCodeFrameId] = useState<string | null>(null)
  const codeFrame = board?.frames.find((frame) => frame.id === codeFrameId && frame.kind === 'sketch')
  const [websiteEditor, setWebsiteEditor] = useState<{ frameId?: string } | null>(null)
  const websiteFrame = board?.frames.find((frame) => frame.id === websiteEditor?.frameId && frame.kind === 'website')
  const websiteEditorOpen = !!websiteEditor && (!websiteEditor.frameId || !!websiteFrame)
  const openWebsite = useCallback((frameId?: string) => setWebsiteEditor({ frameId }), [])
  const [menu, setMenu] = useState<{ x: number; y: number; items: (MenuItem | 'divider')[] } | null>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const overlayOpen = !!menu || !!confirmState || !!codeFrame || websiteEditorOpen || shortcutsOpen || connectOpen || searchOpen || playerOpen
  const autoFit = useRef<{ taskId?: string; firstFrameShown?: boolean } | null>({})

  // The camera can be set at once (wheel, drag) or glide to a target (fit, jump to a frame).
  const glideFrame = useRef(0)
  useEffect(() => () => cancelAnimationFrame(glideFrame.current), [])
  const setCamera = useCallback((update: Camera | ((c: Camera) => Camera)) => {
    autoFit.current = null
    cancelAnimationFrame(glideFrame.current)
    camera.set(update)
  }, [camera])
  const glide = useCallback((to: Camera) => {
    cancelAnimationFrame(glideFrame.current)
    if (reducedMotion()) return camera.set(to)
    const from = camera.get()
    const t0 = performance.now()
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 380)
      const e = 1 - Math.pow(1 - p, 4)
      camera.set({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z: from.z * Math.pow(to.z / from.z, e) })
      if (p < 1) glideFrame.current = requestAnimationFrame(step)
    }
    glideFrame.current = requestAnimationFrame(step)
  }, [camera])

  const stageSize = useCallback(() => {
    const r = stageRef.current?.getBoundingClientRect()
    return { w: r?.width ?? 1000, h: r?.height ?? 700 }
  }, [])

  const fitBoxes = useCallback(
    (boxes: Box[], maxZoom = 1, animate = true, reservedRight = rightInset) => {
      if (boxes.length === 0) return
      const { w, h } = stageSize()
      const minX = Math.min(...boxes.map((b) => b.x))
      const minY = Math.min(...boxes.map((b) => b.y))
      const maxX = Math.max(...boxes.map((b) => b.x + b.w))
      const maxY = Math.max(...boxes.map((b) => b.y + b.h))
      const pad = 72
      const openW = w - leftInset - reservedRight
      const openH = h - CHROME.top - CHROME.bottom
      const z = Math.max(0.05, Math.min(maxZoom, (openW - pad * 2) / (maxX - minX), (openH - pad * 2) / (maxY - minY)))
      const target = { z, x: leftInset + openW / 2 - ((minX + maxX) / 2) * z, y: CHROME.top + openH / 2 - ((minY + maxY) / 2) * z }
      if (animate) {
        autoFit.current = null
        glide(target)
      } else {
        camera.set(target)
      }
    },
    [stageSize, leftInset, rightInset, glide, camera],
  )

  const fit = useCallback(() => {
    if (board) fitBoxes(visibleFrames(board, pageId))
  }, [board, pageId, fitBoxes])

  const flyTo = useCallback((frame: Frame) => {
    if (board && framePage(board, frame) !== pageId) {
      setRequestedPageId(framePage(board, frame))
      setDraft(null)
      setOpenThread(null)
    }
    fitBoxes([frame], 0.9)
  }, [board, pageId, fitBoxes, setOpenThread])

  const switchPage = useCallback((id: string) => {
    cancelAnimationFrame(glideFrame.current)
    autoFit.current = {}
    setRequestedPageId(id)
    setSelection([])
    setInteractId(null)
    setDraft(null)
    setOpenThread(null)
    frameGesture.set({})
    camera.set(INITIAL_CAMERA)
  }, [camera, frameGesture, setOpenThread])

  useEffect(() => {
    const pending = autoFit.current
    if (!board || !pending) return
    const frames = visibleFrames(board, pageId)
    if (!frames.length) {
      pending.taskId ??= board.tasks.find((task) => task.status !== 'done' && (task.pageId ?? boardPages(board)[0]!.id) === pageId)?.id
      return
    }
    // Show the first frame immediately, then fit the full first delivery once it is ready.
    const task = board.tasks.find((task) => task.id === pending.taskId)
    if (!task || task.status === 'done') autoFit.current = null
    if (pending.firstFrameShown && task?.status !== 'done') return
    pending.firstFrameShown = true
    const results = task?.status === 'done' ? taskResultFrames(board, task) : []
    const onPage = results.filter((frame) => framePage(board, frame) === pageId)
    fitBoxes(onPage.length ? onPage : frames, 1, false)
  }, [board, pageId, fitBoxes])

  const select = useCallback((ids: string[]) => {
    if (ids.length) autoFit.current = null
    setSelection(ids)
    setInteractId((cur) => (cur && ids.includes(cur) ? cur : null))
  }, [])

  const showResult = useCallback((frames: Frame[]) => {
    if (!board || !frames.length) return
    const resultPage = frames.some((frame) => framePage(board, frame) === pageId) ? pageId : framePage(board, frames[0]!)
    if (resultPage !== pageId) {
      setRequestedPageId(resultPage)
      setDraft(null)
      setOpenThread(null)
    }
    const byStack = new Map<string, Frame>()
    for (const frame of frames) {
      if (framePage(board, frame) !== resultPage) continue
      const key = frame.deckId ?? frame.id
      const previous = byStack.get(key)
      if (previous && previous.id === board.decks[key]?.front) continue
      byStack.set(key, frame)
    }
    const shown = [...byStack.values()]
    const reveals = shown.flatMap((frame): Op[] =>
      frame.deckId && board.decks[frame.deckId]?.front !== frame.id
        ? [{ type: 'deck.front', deckId: frame.deckId, frameId: frame.id }]
        : [],
    )
    if (reveals.length) dispatch({ type: 'batch', ops: reveals })
    select(shown.map((f) => f.id))
    fitBoxes(shown, 0.9)
  }, [board, pageId, dispatch, select, fitBoxes, setOpenThread])
  const toggle = useCallback((id: string) => {
    autoFit.current = null
    setSelection((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }, [])

  const openLoupe = useCallback(
    (ids?: string[]) => {
      if (!board) return
      const pick = ids ?? selection
      if (pick.length === 2) {
        setLoupe([pick[0]!, pick[1]!])
        return
      }
      // One frame in a deck: compare it with the variant before it.
      const one = board.frames.find((f) => f.id === pick[0])
      if (one?.deckId) {
        const members = deckMembers(board, one.deckId)
        const i = members.findIndex((m) => m.id === one.id)
        const other = members[i > 0 ? i - 1 : 1]
        if (other) {
          setLoupe([other.id, one.id])
        }
      }
    },
    [board, selection],
  )

  const placeFrame = useCallback(
    (content: Pick<Frame, 'kind' | 'name' | 'url' | 'html' | 'route' | 'state'>, size = { w: 1280, h: 800 }) => {
      const { w, h } = stageSize()
      const cx = leftInset + (w - leftInset - rightInset) / 2
      const cy = CHROME.top + (h - CHROME.top - CHROME.bottom) / 2
      const view = camera.get()
      const x = Math.round((cx - view.x) / view.z - size.w / 2)
      const y = Math.round((cy - view.y) / view.z - size.h / 2)
      const id = newId()
      const frame = { id, pageId, ...content, x, y, ...size }
      dispatch({ type: 'frame.create', frame })
      select([id])
      setToolState('select')
      return frame
    },
    [camera, dispatch, pageId, stageSize, leftInset, rightInset, select],
  )

  const addFrame = useCallback((kind: 'live' | 'sketch', component?: SketchComponent) => {
    if (kind === 'live') placeFrame({ kind, name: 'Home', url: '/', route: '/', state: 'default' })
    else placeFrame({ kind, name: component?.name ?? 'New sketch', html: component?.html ?? BLANK_SKETCH }, component && { w: component.w, h: component.h })
  }, [placeFrame])

  const saveWebsite = (url: URL) => {
    const frame = websiteFrame ?? placeFrame({ kind: 'website', name: url.hostname, url: url.href })
    if (websiteFrame) {
      const useHostname = websiteFrame.name === parseWebsiteUrl(websiteFrame.url)?.hostname
      dispatch({ type: 'frame.update', id: websiteFrame.id, patch: { url: url.href, ...(useHostname ? { name: url.hostname } : {}) } })
    }
    const reservedRight = websiteFrame ? rightInset : rightInset - designInset + (designFitsCanvas ? DESIGN_PANEL_WIDTH + 10 : 0)
    fitBoxes([frame], 1, true, reservedRight)
    setWebsiteEditor(null)
  }

  const placeImages = useCallback(async (files: File[]) => {
    const outcomes = await Promise.allSettled(files.map(imageSketch))
    const images = outcomes.flatMap((outcome) => outcome.status === 'fulfilled' ? [outcome.value] : [])
    const failure = outcomes.find((outcome) => outcome.status === 'rejected')
    if (failure) toast(failure.reason instanceof Error ? failure.reason.message : 'Couldn’t open that image.')
    if (!images.length) return

    const { w, h } = stageSize()
    const view = camera.get()
    const centerX = (leftInset + (w - leftInset - rightInset) / 2 - view.x) / view.z
    const centerY = (CHROME.top + (h - CHROME.top - CHROME.bottom) / 2 - view.y) / view.z
    const rowWidth = images.reduce((width, image) => width + image.w, 48 * (images.length - 1))
    let x = Math.round(centerX - rowWidth / 2)
    const frames = images.map((image) => {
      const frame = { ...image, id: newId(), kind: 'sketch' as const, pageId, x, y: Math.round(centerY - image.h / 2) }
      x += image.w + 48
      return frame
    })
    dispatch({ type: 'batch', ops: frames.map((frame) => ({ type: 'frame.create', frame })) })
    if (activePage.current === pageId) {
      select(frames.map((frame) => frame.id))
      fitBoxes(frames, 1)
    }
  }, [camera, pageId, stageSize, leftInset, rightInset, dispatch, select, fitBoxes, toast])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (overlayOpen || loupe || isTyping(event.target)) return
      const images = Array.from(event.clipboardData?.files ?? []).filter(isBoardImage)
      if (!images.length) return
      event.preventDefault()
      void placeImages(images)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [overlayOpen, loupe, placeImages])

  // Element editing: tell frames when they are open for editing, and listen to what they report.
  const editingRef = useRef<string | null>(null)
  const componentRequest = useRef<{ id: string; frameId: string } | null>(null)
  const saveComponent = useCallback((path: string) => {
    const frameId = editingRef.current
    if (!frameId) return
    const id = newId()
    componentRequest.current = { id, frameId }
    sendToFrame(frameId, { type: 'save-component', path, requestId: id })
  }, [])
  const prevEditing = useRef<string | null>(null)
  useEffect(() => {
    editingRef.current = interactId
    if (prevEditing.current && prevEditing.current !== interactId) sendToFrame(prevEditing.current, { type: 'edit', on: false })
    prevEditing.current = interactId
    if (interactId) sendToFrame(interactId, { type: 'edit', on: true })
  }, [interactId])
  if (!interactId && (layers || pickedElement)) {
    setLayers(null)
    setPickedElement(null)
  }
  const historyRef = useRef({ undo, redo })
  useEffect(() => {
    historyRef.current = { undo, redo }
  }, [undo, redo])
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const m = e.data as ({ __zeko?: number } & import('@/lib/client/bridge').FromFrame) | null
      if (!m || m.__zeko !== 1) return
      const id = frameIdOf(e.source)
      if (!id) return
      const open = editingRef.current === id
      switch (m.type) {
        case 'ready':
          if (open) sendToFrame(id, { type: 'edit', on: true })
          return
        case 'tree':
          if (open) setLayers(m.tree)
          return
        case 'selected':
          if (open) setPickedElement(m.info ? { frameId: id, info: m.info } : null)
          return
        case 'component':
          if (open && componentRequest.current?.id === m.requestId && componentRequest.current.frameId === id) {
            componentRequest.current = null
            if (!m.component) return toast('This element can’t be saved as a component.')
            dispatch({ type: 'component.save', component: { ...m.component, id: m.requestId } })
            toast('Component saved')
          }
          return
        case 'html':
          noteBridgeHtml(id, m.html)
          dispatch({ type: 'frame.update', id, patch: { html: m.html } })
          return
        case 'escape':
          setInteractId(null)
          return
        case 'history':
          return m.redo ? historyRef.current.redo() : historyRef.current.undo()
        case 'hotspots':
          setHotspots((h) => {
            if (!m.items.length && !h[id]?.length) return h
            return { ...h, [id]: m.items }
          })
          return
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [dispatch, toast])
  const toFrame = useCallback((message: ToFrame) => {
    if (editingRef.current) sendToFrame(editingRef.current, message)
  }, [])

  const setTool = useCallback((next: Tool) => {
    // Drawing happens on the board, so leave the sketch being edited.
    if (next !== 'select') setInteractId(null)
    setToolState(next)
  }, [])
  const play = useCallback(
    (frameId?: string) => {
      if (!board) return
      const screens = visibleFrames(board, pageId).filter((f) => f.kind === 'sketch' && !f.shape)
      const start =
        (frameId && board.frames.find((f) => f.id === frameId)) ||
        board.frames.find((f) => f.id === pageStart(board, pageId)) ||
        board.frames.find((f) => f.id === selection[0] && f.kind === 'sketch' && !f.shape) ||
        screens.find((f) => f.html?.includes('data-zeko-goto=')) ||
        [...screens].sort((a, b) => a.y - b.y || a.x - b.x)[0]
      if (!start) return toast('Add a screen to play')
      setPlaying(start.id)
    },
    [board, pageId, selection, toast],
  )

  const openMenu = useCallback((x: number, y: number, items: (MenuItem | 'divider')[]) => setMenu({ x, y, items }), [])
  const closeMenu = useCallback(() => setMenu(null), [])
  const confirm = useCallback((c: ConfirmState) => setConfirmState(c), [])

  const value = useMemo<StudioState | null>(
    () =>
      board && {
        boardId,
        board,
        pageId,
        switchPage,
        dispatch,
        undo,
        redo,
        history,
        now,
        selection,
        select,
        toggle,
        tool,
        setTool,
        prototype,
        setPrototype,
        hotspots,
        play,
        playerOpen,
        viewport: camera,
        setCamera,
        stageRef,
        flyTo,
        showResult,
        fit,
        frameGesture,
        interactId,
        setInteractId,
        layers,
        element,
        toFrame,
        draft,
        setDraft,
        openThread,
        threadInPanel,
        setOpenThread,
        openLoupe,
        openConnect: () => setConnectOpen(true),
        openAgents: () => {
          setPanelClosed(false)
          setAgentPanelRequest((request) => request + 1)
        },
        openShortcuts: () => setShortcutsOpen(true),
        openSearch: () => setSearchOpen(true),
        addFrame,
        openWebsite,
        openCode: setCodeFrameId,
        saveComponent,
        toast,
        openMenu,
        confirm,
      },
    [boardId, board, pageId, switchPage, dispatch, undo, redo, history, now, selection, select, toggle, tool, setTool, prototype, hotspots, play, playerOpen, camera, setCamera, flyTo, showResult, fit, frameGesture, interactId, layers, element, toFrame, draft, openThread, threadInPanel, setOpenThread, openLoupe, addFrame, openWebsite, saveComponent, toast, openMenu, confirm],
  )

  if (!value) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-3 text-slate">
          <span className={connection === 'offline' || connection === 'missing' ? '' : 'motion-safe:animate-pulse'}>
            <Mark size={28} />
          </span>
          {connection === 'missing' ? (
            <>
              This canvas doesn’t exist. It may have been deleted.
              <Link href="/" className="text-ink underline decoration-hair underline-offset-4 hover:decoration-ink">
                Go to all canvases
              </Link>
            </>
          ) : connection === 'offline' ? (
            <>
              Couldn’t open this canvas.
              <button type="button" className="text-ink underline underline-offset-4" onClick={() => window.location.reload()}>Try again</button>
            </>
          ) : (
            <span role="status">Opening the canvas…</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <StudioContext.Provider value={value}>
      <Keys loupe={loupe} setLoupe={setLoupe} overlayOpen={overlayOpen} toggleShortcuts={() => setShortcutsOpen((o) => !o)} />
      <div className="studio relative h-full overflow-hidden">
        <Canvas leftInset={leftInset} rightInset={rightInset} railLeft={railLeft} onShowLayers={leftClosed ? () => setLeftClosed(false) : undefined} />
        <TopBar connection={connection} saveState={saveState} onImport={importBoard} placeImages={placeImages}
          connectOpen={connectOpen} onConnectOpenChange={setConnectOpen} />
        <LeftPanel closed={leftClosed} onClose={() => setLeftClosed(true)} />
        {sampleGuide && <GettingStarted left={railLeft} />}
        <div className="absolute bottom-2 z-10" style={{ right: panelControlsOffset }}><ZoomPill /></div>
        <SidePanel
          agentPanelRequest={agentPanelRequest}
          width={panelWidth}
          maxWidth={maxPanelWidth}
          closed={panelClosed}
          onClosedChange={setPanelClosed}
          onResize={resizePanel}
        />
        {selection.length > 0 && (
          <DesignPanel
            open={designOpen}
            right={designOffset}
            width={DESIGN_PANEL_WIDTH}
            overlay={!designFitsBesideAgents}
            onOpenChange={(open) => setDesignPreference({ selectionKey, open })}
          />
        )}
      </div>
      {loupe && <Loupe ids={loupe} onClose={() => setLoupe(null)} onSwap={() => setLoupe([loupe[1], loupe[0]])} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
      {codeFrame && <SketchCodeDialog key={codeFrame.id} frame={codeFrame} onClose={() => setCodeFrameId(null)} />}
      {websiteEditorOpen && <WebsiteDialog key={websiteFrame?.id ?? 'new'} address={websiteFrame?.url ?? (websiteFrame ? '' : undefined)} onSave={saveWebsite} onClose={() => setWebsiteEditor(null)} />}
      {playing && <Player board={board!} start={playing} onClose={() => setPlaying(null)} />}
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
      {confirmState && <ConfirmDialog {...confirmState} onClose={() => setConfirmState(null)} />}
    </StudioContext.Provider>
  )
}

/** Keyboard: tools, decks, deletion and the loupe. */
function Keys({
  loupe,
  setLoupe,
  overlayOpen,
  toggleShortcuts,
}: {
  loupe: [string, string] | null
  setLoupe: (l: null) => void
  overlayOpen: boolean
  toggleShortcuts: () => void
}) {
  const s = useStudio()
  const act = useFrameActions()
  useEffect(() => {
    const { board, selection, draft, openThread, interactId } = s
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || overlayOpen) return
      if (e.target instanceof Element && e.target.closest('[role="menu"], [role="dialog"], [role="alertdialog"]')) return
      const mod = e.metaKey || e.ctrlKey
      const single = selection.length === 1 ? board.frames.find((f) => f.id === selection[0]) : undefined

      if (e.key === 'Escape') {
        if (loupe) return setLoupe(null)
        if (draft) return s.setDraft(null)
        if (openThread) return s.setOpenThread(null)
        if (interactId && s.element) return s.toFrame({ type: 'select', path: null })
        if (interactId) return s.setInteractId(null)
        if (s.tool !== 'select') return s.setTool('select')
        s.select([])
        return
      }
      if (interactId || loupe) return
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        return e.shiftKey ? s.redo() : s.undo()
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        return s.redo()
      }
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        return s.openSearch()
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        return s.select(visibleFrames(board, s.pageId).map((f) => f.id))
      }
      if (mod && e.key.toLowerCase() === 'd' && single) {
        e.preventDefault()
        return act.variant(single)
      }
      if (mod) return
      if (e.key === '?') return toggleShortcuts()
      if (e.shiftKey && e.code === 'Digit1') return s.fit()
      if (e.shiftKey && e.code === 'Digit2' && single) return s.flyTo(single)
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && single?.deckId) {
        e.preventDefault()
        const members = deckMembers(board, single.deckId)
        const i = members.findIndex((m) => m.id === single.id)
        const next = members[(i + (e.key === 'ArrowRight' ? 1 : -1) + members.length) % members.length]!
        s.dispatch({ type: 'deck.front', deckId: single.deckId, frameId: next.id })
        s.select([next.id])
        return
      }
      switch (e.key.toLowerCase()) {
        case 'v':
          return s.setTool('select')
        case 'h':
          return s.setTool('hand')
        case 'c':
          return s.setTool('comment')
        case 'f':
          return s.setTool('frame')
        case 'r':
          return s.setTool('rect')
        case 'o':
          return s.setTool('ellipse')
        case 'p':
          return s.setTool('path')
        case 't':
          return s.setTool('text')
        case 'a':
          if (LIVE_FRAMES) s.addFrame('live')
          return
        case 's':
          return s.addFrame('sketch')
        case 'l':
          return s.openLoupe()
        case 'k':
          if (single?.deckId) act.keep(single)
          return
        case 'enter':
          if (single && (single.kind !== 'live' || LIVE_FRAMES)) act.use(single)
          return
        case 'backspace':
        case 'delete':
          return act.remove(selection)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s, act, loupe, setLoupe, overlayOpen, toggleShortcuts])
  return null
}
