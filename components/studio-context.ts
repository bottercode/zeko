'use client'

import { createContext, useContext, useSyncExternalStore, type RefObject } from 'react'
import { INITIAL_CAMERA, type Camera, type createCamera } from '@/lib/client/camera'
import type { createFrameGesture } from '@/lib/client/frame-gesture'
import type { Board, Frame, Op, SketchComponent } from '@/lib/types'
import type { ElementInfo, Hotspot, LayerNode, ToFrame } from '@/lib/client/bridge'
import type { MenuItem } from './kit'

export type DrawTool = 'frame' | 'rect' | 'ellipse' | 'path' | 'text'
export type Tool = 'select' | 'hand' | 'comment' | DrawTool

export const isDrawTool = (t: Tool): t is DrawTool => t === 'frame' || t === 'rect' || t === 'ellipse' || t === 'path' || t === 'text'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Draft {
  frameId: string
  x: number
  y: number
}

export interface StudioState {
  /** the canvas this studio shows */
  boardId: string
  board: Board
  pageId: string
  switchPage: (id: string) => void
  dispatch: (op: Op) => void
  undo: () => void
  redo: () => void
  history: { canUndo: boolean; canRedo: boolean }
  now: number

  selection: string[]
  select: (ids: string[]) => void
  toggle: (id: string) => void

  tool: Tool
  setTool: (tool: Tool) => void
  /** Prototype mode: links between screens show as arrows, and clicking a sketch picks the element to link. */
  prototype: boolean
  setPrototype: (on: boolean) => void
  /** Each sketch's prototype links, as its document reports them. */
  hotspots: Record<string, Hotspot[]>
  /** Opens the prototype player on a screen. */
  play: (frameId?: string) => void
  playerOpen: boolean

  viewport: ReturnType<typeof createCamera>
  setCamera: (update: Camera | ((c: Camera) => Camera)) => void
  stageRef: RefObject<HTMLDivElement | null>
  flyTo: (frame: Frame) => void
  showResult: (frames: Frame[]) => void
  fit: () => void

  /** Transient positions and alignment guides while dragging or resizing. */
  frameGesture: ReturnType<typeof createFrameGesture>

  /** The frame being worked inside: a sketch open for element editing, or a live page in use. */
  interactId: string | null
  setInteractId: (id: string | null) => void
  /** Inside a sketch being edited: its layers and the picked element. */
  layers: LayerNode[] | null
  element: ElementInfo | null
  toFrame: (message: ToFrame) => void

  draft: Draft | null
  setDraft: (draft: Draft | null) => void
  openThread: string | null
  threadInPanel: boolean
  setOpenThread: (id: string | null, location?: 'canvas' | 'panel') => void

  openLoupe: (ids?: string[]) => void
  openConnect: () => void
  openAgents: () => void
  openShortcuts: () => void
  openSearch: () => void
  addFrame: (kind: 'live' | 'sketch', component?: SketchComponent) => void
  openWebsite: (frameId?: string) => void
  openCode: (frameId: string) => void
  saveComponent: (path: string) => void
  /** Opens a component's main copy on the canvas, creating it if needed. */
  editComponent: (component: SketchComponent) => void
  /** Puts HTML into the sketch being edited: inside the selected container, after the selected element, or at the end. */
  insertHtml: (html: string) => boolean

  /** Feedback and choices that float above everything. */
  toast: (text: string) => void
  openMenu: (x: number, y: number, items: (MenuItem | 'divider')[]) => void
  confirm: (c: { title: string; body: string; confirm: string; returnFocus?: React.RefObject<HTMLElement | null>; onConfirm: () => void }) => void
}

export const StudioContext = createContext<StudioState | null>(null)

export function useStudio(): StudioState {
  const ctx = useContext(StudioContext)
  if (!ctx) throw new Error('useStudio outside <Studio>')
  return ctx
}

export function useCameraZoom() {
  const { viewport } = useStudio()
  return useSyncExternalStore(viewport.subscribeZoom, viewport.getZoom, () => INITIAL_CAMERA.z)
}

export function useCameraSnapshot() {
  const { viewport } = useStudio()
  return useSyncExternalStore(viewport.subscribe, viewport.get, () => INITIAL_CAMERA)
}

export const SIZES: { label: string; w: number; h: number }[] = [
  { label: 'Desktop', w: 1440, h: 900 },
  { label: 'Laptop', w: 1280, h: 800 },
  { label: 'Tablet', w: 834, h: 1112 },
  { label: 'Phone', w: 390, h: 844 },
]

/** Where the floating panels sit over the canvas, so fits and new frames land in the open area. */
export const CHROME = { top: 64, bottom: 12 }
export const SIDE_PANEL = { minWidth: 240, defaultWidth: 312, maxWidth: 640 }
export const LEFT_PANEL_WIDTH = 264
