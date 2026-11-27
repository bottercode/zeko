'use client'

import { useState } from 'react'
import {
  Boxes,
  ChevronRight,
  ChevronsDownUp,
  Circle,
  PenTool,
  FileText,
  Globe,
  Hash,
  Image as ImageIcon,
  Layers as LayersIcon,
  LayoutList,
  Link2,
  MousePointerClick,
  PanelLeftClose,
  Pencil,
  Plus,
  Route,
  Search,
  Shapes,
  Sparkles,
  Square,
  Component,
  Ellipsis,
  TextCursorInput,
  Type,
  Palette,
  Trash2,
  X,
} from 'lucide-react'
import { AGENT_AWAY_MS, boardPages, byRoute, deckMembers, UNROUTED, visibleFrames } from '@/lib/ops'
import { agentColor, newId } from '@/lib/client/useBoard'
import type { LayerNode } from '@/lib/client/bridge'
import type { Frame, SketchComponent } from '@/lib/types'
import { LEFT_PANEL_WIDTH, useStudio } from './studio-context'
import { Heading, IconButton, Tip, cx } from './kit'
import { TokensPanel } from './TokensPanel'
import { ChoiceSelect } from './ChoiceSelect'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './ui/input-group'
import { Separator } from './ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'
import { countInstances } from '@/lib/components'

const TABS = [
  { id: 'layers', label: 'Layers', Icon: LayersIcon },
  { id: 'components', label: 'Components', Icon: Boxes },
  { id: 'tokens', label: 'Tokens', Icon: Palette },
] as const

export function LeftPanel({ closed, onClose }: { closed: boolean; onClose: () => void }) {
  return (
    <aside
      id="studio-left-panel"
      aria-label="Left panel"
      hidden={closed}
      className="panel absolute top-14 bottom-2 left-2 z-10 overflow-hidden"
      style={{ width: LEFT_PANEL_WIDTH }}
    >
      <Tabs defaultValue="layers" className="h-full gap-0">
        <div className="editor-divider flex h-11 shrink-0 items-center justify-between gap-1 border-b px-2">
          <TabsList variant="line" aria-label="Left panel views" activateOnFocus className="editor-tabs min-w-0">
            {TABS.map(({ id, label, Icon }) => (
              <Tip key={id} label={label}>
                <TabsTrigger value={id} aria-label={label} className="editor-control editor-tab group">
                  <Icon size={15} strokeWidth={1.75} />
                  <span aria-hidden className="hidden group-data-active:inline">{label}</span>
                </TabsTrigger>
              </Tip>
            ))}
          </TabsList>
          <IconButton label="Hide the left panel" aria-expanded aria-controls="studio-left-panel" onClick={onClose} className="size-7 shrink-0">
            <PanelLeftClose size={15} strokeWidth={1.75} />
          </IconButton>
        </div>

        <TabsContent value="layers" keepMounted className="editor-content flex min-h-0 flex-col">
          <LayersTab />
        </TabsContent>
        <TabsContent value="components" keepMounted className="editor-content flex min-h-0 flex-col">
          <ComponentsTab />
        </TabsContent>
        <TabsContent value="tokens" className="editor-content flex min-h-0 flex-col">
          <TokensPanel />
        </TabsContent>
      </Tabs>
    </aside>
  )
}

function PanelSearch({ query, setQuery, label }: { query: string; setQuery: (value: string) => void; label: string }) {
  return (
    <div className="editor-divider shrink-0 border-t p-2">
      <InputGroup>
        <InputGroupAddon><Search aria-hidden /></InputGroupAddon>
        <InputGroupInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            setQuery('')
            e.currentTarget.blur()
          }}
          placeholder={label}
          aria-label={label}
        />
        {query && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => setQuery('')}><X aria-hidden /></InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
    </div>
  )
}

function ComponentsTab() {
  const { board, element, interactId, addFrame, saveComponent, editComponent, insertHtml, dispatch, toast } = useStudio()
  const [query, setQuery] = useState('')
  const components = board.components ?? []
  const term = query.trim().toLowerCase()
  const shown = components.filter((component) => !term || component.name.toLowerCase().includes(term) || component.tag.includes(term))
  const editingSketch = !!interactId && board.frames.some((frame) => frame.id === interactId && frame.kind === 'sketch' && !frame.componentId)
  const uses = (id: string) => board.frames.reduce((total, frame) => total + (frame.componentId ? 0 : countInstances(frame.html, id)), 0)
  const insert = (component: SketchComponent) => {
    if (editingSketch && component.body && insertHtml(component.body)) return toast(`Inserted ${component.name}`)
    addFrame('sketch', component)
  }
  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto p-2.5">
        <Heading action={
          <IconButton label="Save selected element as component" disabled={!element} onClick={() => element && saveComponent(element.path)} className="size-6">
            <Plus size={14} />
          </IconButton>
        }>Library</Heading>
        {components.length > 0 && (
          <p className="px-1 pb-2 text-xs text-slate">
            {editingSketch ? 'Click to place an instance in the sketch you are editing.' : 'Open a sketch to place instances, or click to add one as a frame.'}
          </p>
        )}
        {components.length === 0 ? (
          <div className="flex flex-col items-start gap-2 px-1 py-5">
            <Boxes size={19} strokeWidth={1.5} className="text-slate" />
            <p className="font-medium text-ink">No components yet</p>
            <p className="text-sm leading-relaxed text-slate">Select an element in a sketch, then save it here. Every copy you place stays in step with the main component.</p>
          </div>
        ) : shown.length === 0 ? (
          <p className="px-1 py-3 text-sm text-slate">No matching components.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {shown.map((component) => {
              const count = uses(component.id)
              return (
                <li key={component.id} className="group flex min-w-0 items-center gap-1 rounded-md bg-wash/50">
                  <button
                    aria-label={editingSketch ? `Place ${component.name} in the sketch` : `Add ${component.name} as a frame`}
                    onClick={() => insert(component)}
                    className="editor-control flex h-9 min-w-0 flex-1 items-center gap-2 px-2 text-left"
                  >
                    <Component size={14} strokeWidth={1.75} className="shrink-0 text-grease" />
                    <span className="min-w-0 flex-1 truncate text-ink">{component.name}</span>
                    {count > 0 && <span className="shrink-0 text-2xs tabular-nums text-mist" title={`${count} instance${count === 1 ? '' : 's'}`}>{count}×</span>}
                    <Plus size={13} strokeWidth={1.75} className="shrink-0" />
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`${component.name} actions`} className="editor-control mr-1 shrink-0" />}>
                      <Ellipsis size={13} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuGroup>
                        <DropdownMenuItem onClick={() => editComponent(component)}><Pencil aria-hidden /> Edit main component</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => addFrame('sketch', component)}><Hash aria-hidden /> Add as a frame</DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem variant="destructive" onClick={() => {
                          dispatch({ type: 'component.remove', id: component.id })
                          if (count) toast(`Removed ${component.name}. Its ${count} instance${count === 1 ? ' stays' : 's stay'} as plain layers`)
                        }}><Trash2 aria-hidden /> Remove from library</DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <PanelSearch query={query} setQuery={setQuery} label="Search components" />
    </>
  )
}

function useWorkingOn() {
  const { board, now } = useStudio()
  const workingOn = new Map<string, string>()
  for (const a of Object.values(board.agents)) {
    if (!a.working || !a.frameId || (now && now - a.lastSeen > AGENT_AWAY_MS)) continue
    const f = board.frames.find((x) => x.id === a.frameId)
    if (f) workingOn.set(f.deckId ?? f.id, a.name)
  }
  return workingOn
}

/* ---------- Layers: pages, then the frames on the page, opening into elements while a sketch is edited ---------- */

function Pages() {
  const { board, pageId, switchPage, dispatch, selection, select } = useStudio()
  const [editing, setEditing] = useState<string | null>(null)
  const pages = boardPages(board)
  const add = () => {
    let number = pages.length + 1
    while (pages.some((p) => p.name === `Page ${number}`)) number++
    const id = newId()
    dispatch({ type: 'page.add', id, name: `Page ${number}` })
    switchPage(id)
  }

  return (
    <section className="px-1 pt-3">
      <div className="px-1.5">
        <Heading action={
          <Tip label="Add page">
            <button aria-label="Add page" onClick={add} className="grid size-5 place-items-center rounded text-mist hover:text-ink">
              <Plus size={13} />
            </button>
          </Tip>
        }>Pages</Heading>
      </div>
      <ul className="flex flex-col gap-0.5">
        {pages.map((page, index) => {
          const count = visibleFrames(board, page.id).length
          const canRemove = index > 0 && count === 0 && !board.tasks.some((task) => task.pageId === page.id && task.status !== 'done')
          return (
            <li key={page.id} className={cx('group flex h-7 items-center rounded-md pr-1.5 text-sm', pageId === page.id ? 'bg-wash' : 'hover:bg-wash/60')}>
              {editing === page.id ? (
                <Input
                  aria-label="Page name"
                  autoFocus
                  defaultValue={page.name}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => {
                    const name = e.currentTarget.value.trim()
                    if (name && name !== page.name) dispatch({ type: 'page.rename', id: page.id, name })
                    setEditing(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  className="mx-1 h-6 min-w-0 flex-1 rounded bg-panel px-1.5"
                />
              ) : (
                <button aria-current={pageId === page.id ? 'page' : undefined} onClick={() => pageId !== page.id && switchPage(page.id)} className="flex h-full min-w-0 flex-1 items-center gap-2 px-2.5 text-left">
                  <FileText size={13} className="shrink-0 text-mist" />
                  <span className="flex-1 truncate">{page.name}</span>
                </button>
              )}
              <span className="mr-1 text-2xs text-mist tabular-nums">{count}</span>
              <button aria-label={`Rename ${page.name}`} onClick={() => setEditing(page.id)} className="grid size-5 place-items-center rounded text-mist opacity-0 hover:text-ink focus:opacity-100 group-hover:opacity-100">
                <Pencil size={11} />
              </button>
              {canRemove && (
                <button aria-label={`Remove empty page ${page.name}`} onClick={() => {
                  dispatch({ type: 'page.remove', id: page.id })
                  if (page.id === pageId) switchPage(pages[0]!.id)
                }} className="grid size-5 place-items-center rounded text-mist opacity-0 hover:text-grease focus:opacity-100 group-hover:opacity-100">
                  <Trash2 size={11} />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {selection.length > 0 && pages.length > 1 && (
        <ChoiceSelect label="Move selection to page" placeholder="Move selection to page…" value={null}
          size="sm" className="mt-2 w-full"
          options={pages.filter((page) => page.id !== pageId).map((page) => ({ value: page.id, label: page.name }))}
          onChange={(id) => {
            dispatch({ type: 'page.moveFrames', pageId: id, frameIds: selection })
            select([])
          }} />
      )}
    </section>
  )
}

function LayersTab() {
  const { board, pageId } = useStudio()
  const [query, setQuery] = useState('')
  const [byScreen, setByScreen] = useState(false)
  const [openAll, setOpenAll] = useState(0)
  const [focusedLayer, setFocusedLayer] = useState<string | null>(null)
  const q = query.trim().toLowerCase()
  const frames = [...visibleFrames(board, pageId)].sort((a, b) => a.y - b.y || a.x - b.x)
  const shown = q ? frames.filter((f) => f.name.toLowerCase().includes(q) || (f.deckId && deckMembers(board, f.deckId).some((m) => m.name.toLowerCase().includes(q)))) : frames

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-3">
        <Pages />
        <Separator className="editor-divider my-3" />
        <section className="px-1">
          <div className="px-1.5">
            <Heading action={
              <div className="flex items-center gap-0.5">
                {!byScreen && (
                  <IconButton label="Collapse all" onClick={() => setOpenAll((n) => n + 1)} className="size-6">
                    <ChevronsDownUp size={13} />
                  </IconButton>
                )}
                <IconButton label="Group screens by route" active={byScreen} onClick={() => setByScreen(!byScreen)} className="size-6">
                  <LayoutList size={14} />
                </IconButton>
              </div>
            }>{byScreen ? 'Screens by route' : 'Layers'}</Heading>
          </div>
          {byScreen ? <ScreensTab query={query} /> : (
            <>
              {shown.length === 0 && <p className="px-2.5 py-2 text-sm text-slate">{q ? `No layer matches “${query.trim()}”.` : 'Frames you add show up here.'}</p>}
              <ul role="tree" aria-label="Frames" onKeyDown={navigateLayers}
                onFocus={(e) => setFocusedLayer((e.target as HTMLElement).closest<HTMLElement>('[data-layer-key]')?.dataset.layerKey ?? null)}
                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocusedLayer(null) }}>
                {shown.map((f) => <FrameRow key={`${f.deckId ?? f.id}:${openAll}`} frame={f} focused={focusedLayer ?? shown[0]?.id} />)}
              </ul>
            </>
          )}
        </section>
      </div>
      <PanelSearch query={query} setQuery={setQuery} label={byScreen ? 'Search screens' : 'Search layers'} />
    </>
  )
}

function navigateLayers(event: React.KeyboardEvent<HTMLUListElement>) {
  const row = (event.target as HTMLElement).closest<HTMLElement>('[data-layer-key]')
  if (!row) return
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-layer-key]'))
  const index = rows.indexOf(row)
  const expanded = row.getAttribute('aria-expanded')
  const parent = row.parentElement?.closest<HTMLElement>('[data-layer-key]')
  let next: HTMLElement | undefined | null
  switch (event.key) {
    case 'ArrowDown': next = rows[index + 1]; break
    case 'ArrowUp': next = rows[index - 1]; break
    case 'Home': next = rows[0]; break
    case 'End': next = rows.at(-1); break
    case 'ArrowRight':
      if (expanded === 'false') row.querySelector<HTMLButtonElement>(':scope > div [data-layer-expand]')?.click()
      if (expanded === 'true') next = row.querySelector<HTMLElement>(':scope > ul > [data-layer-key]')
      break
    case 'ArrowLeft':
      if (expanded === 'true') row.querySelector<HTMLButtonElement>(':scope > div [data-layer-expand]')?.click()
      else next = parent
      break
    case 'Enter':
    case ' ':
      if (event.target !== row) return
      row.querySelector<HTMLButtonElement>(':scope > div [data-layer-select]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, shiftKey: event.shiftKey }),
      )
      break
    default: return
  }
  event.preventDefault()
  event.stopPropagation()
  next?.focus()
}

function FrameRow({ frame, focused }: { frame: Frame; focused?: string }) {
  const { board, dispatch, selection, select, toggle, flyTo, interactId, layers, element, toFrame } = useStudio()
  const workingOn = useWorkingOn()
  const members = frame.deckId ? deckMembers(board, frame.deckId) : []
  const editing = interactId === frame.id
  const [open, setOpen] = useState(false)
  const expanded = open || editing
  const hasChildren = members.length > 1 || editing
  const on = selection.includes(frame.id)
  const worker = workingOn.get(frame.deckId ?? frame.id)
  const pick = (f: Frame, e: React.MouseEvent) => {
    if (e.shiftKey) return toggle(f.id)
    // A variant further down the deck comes to the front, like flipping the deck.
    if (f.deckId && board.decks[f.deckId]?.front !== f.id) dispatch({ type: 'deck.front', deckId: f.deckId, frameId: f.id })
    select([f.id])
    flyTo(f)
  }

  return (
    <li data-layer-key={frame.id} role="treeitem" aria-label={frame.name} aria-selected={on}
      aria-expanded={hasChildren ? expanded : undefined} tabIndex={focused === frame.id ? 0 : -1}
      className="group/layer outline-none focus-visible:[&>div]:ring-1 focus-visible:[&>div]:ring-ring">
      <div className={cx('flex h-7 items-center rounded-md', on ? 'bg-grease-soft' : 'hover:bg-wash')}>
        <Button data-layer-select tabIndex={-1} variant="ghost" size="sm" onClick={(e) => pick(frame, e)}
          className="min-w-0 flex-1 justify-start px-1.5 font-normal">
          <FrameKindIcon frame={frame} on={on} />
          <span className="min-w-0 flex-1 truncate text-left">{frame.name}</span>
          {members.length > 1 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{members.length}</span>}
          {worker && (
            <Tip label={`${worker} is working here`}>
              <span className="size-1.5 shrink-0 rounded-full motion-safe:animate-pulse" style={{ background: agentColor(worker) }} />
            </Tip>
          )}
        </Button>
        {hasChildren && (
          <Button data-layer-expand tabIndex={-1} variant="ghost" size="icon-xs" aria-label={expanded ? 'Collapse layers' : 'Expand layers'} onClick={() => setOpen(!expanded)}>
            <ChevronRight aria-hidden className={cx('transition-transform', expanded && 'rotate-90')} />
          </Button>
        )}
      </div>
      {expanded && (
        <ul role="group">
          {members.length > 1 &&
            members.map((m, i) => (
              <li key={m.id} role="treeitem" data-layer-key={`variant:${m.id}`} aria-label={m.name}
                aria-selected={selection.includes(m.id)} tabIndex={focused === `variant:${m.id}` ? 0 : -1}
                className="outline-none focus-visible:[&>div]:ring-1 focus-visible:[&>div]:ring-ring">
                <div className={cx('rounded-md pl-6', selection.includes(m.id) && 'bg-grease-soft')}>
                  <Button data-layer-select tabIndex={-1} variant="ghost" size="sm" onClick={(e) => pick(m, e)}
                    className="w-full justify-start font-normal">
                    <span className="w-3 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-left">{m.name}</span>
                    {board.decks[frame.deckId!]?.front === m.id && <span className="text-xs text-muted-foreground">on top</span>}
                  </Button>
                </div>
              </li>
            ))}
          {editing && layers === null && <li className="py-1 pl-8 text-xs text-mist">Reading the page…</li>}
          {editing && layers?.map((n) => <ElementRow key={n.path} node={n} depth={1} focused={focused} selected={element?.path ?? null} send={toFrame} />)}
        </ul>
      )}
    </li>
  )
}

const ICONS: Record<LayerNode['kind'], typeof Type> = {
  text: Type,
  image: ImageIcon,
  button: MousePointerClick,
  link: Link2,
  input: TextCursorInput,
  box: Square,
  svg: Shapes,
  shader: Sparkles,
}

/** The layer being dragged in the tree; dataTransfer can't be read during dragover. */
let draggingLayer: string | null = null
type DropPosition = 'before' | 'after' | 'inside'

function ElementRow({ node, depth, focused, selected, send }: { node: LayerNode; depth: number; focused?: string; selected: string | null; send: ReturnType<typeof useStudio>['toFrame'] }) {
  const holdsSelection = !!selected && (selected === node.path || selected.startsWith(node.path + '.'))
  const [open, setOpen] = useState(depth < 2)
  const expanded = open || (holdsSelection && selected !== node.path)
  const Icon = node.instance ? Component : ICONS[node.kind]
  const on = selected === node.path
  const [hint, setHint] = useState<DropPosition | null>(null)
  const positionAt = (event: React.DragEvent<HTMLDivElement>): DropPosition => {
    const r = event.currentTarget.getBoundingClientRect()
    const at = (event.clientY - r.top) / r.height
    if (node.kind === 'box') return at < 0.28 ? 'before' : at > 0.72 ? 'after' : 'inside'
    return at < 0.5 ? 'before' : 'after'
  }
  return (
    <li role="treeitem" data-layer-key={`element:${node.path}`} aria-label={`${node.name}, ${node.tag}`} aria-selected={on}
      aria-expanded={node.children.length ? expanded : undefined} tabIndex={focused === `element:${node.path}` ? 0 : -1}
      className="outline-none focus-visible:[&>div]:ring-1 focus-visible:[&>div]:ring-ring">
      <div className={cx('group relative flex h-7 items-center rounded-md', on ? 'bg-grease-soft' : 'hover:bg-wash', hint === 'inside' && 'ring-1 ring-grease ring-inset')}
        style={{ paddingLeft: 4 + depth * 12 }}
        draggable
        onDragStart={(event) => {
          draggingLayer = node.path
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', node.name)
        }}
        onDragEnd={() => { draggingLayer = null }}
        onDragOver={(event) => {
          const from = draggingLayer
          if (!from || from === node.path || node.path.startsWith(from + '.')) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          const next = positionAt(event)
          if (next !== hint) setHint(next)
        }}
        onDragLeave={() => setHint(null)}
        onDrop={(event) => {
          const from = draggingLayer
          setHint(null)
          draggingLayer = null
          if (!from || from === node.path || node.path.startsWith(from + '.')) return
          event.preventDefault()
          send({ type: 'reparent', path: from, target: node.path, position: positionAt(event) })
        }}
        onPointerEnter={() => send({ type: 'hover', path: node.path })}
        onPointerLeave={() => send({ type: 'hover', path: null })}>
        {hint && hint !== 'inside' && <span aria-hidden className={cx('pointer-events-none absolute right-1 h-0.5 rounded-full bg-grease', hint === 'before' ? '-top-px' : '-bottom-px')} style={{ left: 4 + depth * 12 }} />}
        <Button data-layer-select tabIndex={-1} variant="ghost" size="sm" onClick={() => send({ type: 'select', path: node.path })}
          className="min-w-0 flex-1 justify-start px-1.5 font-normal">
          <Icon aria-hidden className={on || node.instance ? 'text-grease' : 'text-muted-foreground'} />
          <span className="min-w-0 flex-1 truncate text-left">{node.name}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{node.tag}</span>
        </Button>
        {node.children.length > 0 && (
          <Button data-layer-expand tabIndex={-1} variant="ghost" size="icon-xs" aria-label={expanded ? 'Collapse layers' : 'Expand layers'} onClick={() => setOpen(!expanded)}>
            <ChevronRight aria-hidden className={cx('transition-transform', expanded && 'rotate-90')} />
          </Button>
        )}
      </div>
      {expanded && node.children.length > 0 && (
        <ul role="group">
          {node.children.map((c) => (
            <ElementRow key={c.path} node={c} depth={depth + 1} focused={focused} selected={selected} send={send} />
          ))}
        </ul>
      )}
    </li>
  )
}

const SHAPE_ICONS = { rect: Square, ellipse: Circle, path: PenTool, text: Type } as const

function FrameKindIcon({ frame, on }: { frame: Frame; on: boolean }) {
  const Icon = frame.shape ? SHAPE_ICONS[frame.shape] : frame.kind === 'website' ? Globe : Hash
  return <Icon data-icon="inline-start" aria-hidden strokeWidth={1.75} className={on ? 'text-grease' : 'text-slate'} />
}

/* ---------- Screens: the board read by route and state ---------- */

function ScreensTab({ query }: { query: string }) {
  const { board, pageId, selection, select, toggle, flyTo } = useStudio()
  const workingOn = useWorkingOn()
  const all = visibleFrames(board, pageId).filter((f) => !f.shape)
  const q = query.trim().toLowerCase()
  const frames = q ? all.filter((f) => [f.name, f.route, f.state].some((v) => v?.toLowerCase().includes(q))) : all
  const groups = new Map<string, Frame[]>()
  for (const f of frames) {
    const key = f.route?.trim() || UNROUTED
    groups.set(key, [...(groups.get(key) ?? []), f])
  }
  const keys = [...groups.keys()].sort(byRoute)

  return (
    <div className="flex flex-col gap-2.5 pb-3">
      {keys.length === 0 && <p className="px-2.5 py-3 text-sm text-mist">{q ? `Nothing matches “${query.trim()}”.` : 'Frames you add show up here, grouped by route.'}</p>}
      {keys.map((key) => (
        <section key={key} className="overflow-hidden rounded-lg border border-hair">
          <h3 className="flex min-w-0 items-center gap-2 bg-wash/40 px-2.5 py-2 text-xs font-medium text-ink" title={key}>
            <Route aria-hidden size={13} className="shrink-0 text-slate" />
            <span className={cx('truncate', key !== UNROUTED && 'font-mono')}>{key}</span>
          </h3>
          <Separator className="editor-divider" />
          <ul className="flex flex-col gap-0.5 p-1">
            {groups.get(key)!.map((f) => {
              const count = f.deckId ? deckMembers(board, f.deckId).length : 1
              const on = selection.includes(f.id)
              const worker = workingOn.get(f.deckId ?? f.id)
              return (
                <li key={f.deckId ?? f.id}>
                  <Button variant="ghost" size="sm" aria-pressed={on} title={f.name}
                    onClick={(e) => {
                      if (e.shiftKey) return toggle(f.id)
                      select([f.id])
                      flyTo(f)
                    }}
                    className={cx('w-full min-w-0 justify-start px-1.5 font-normal', on && 'bg-grease-soft')}
                  >
                    <FrameKindIcon frame={f} on={on} />
                    <span className="min-w-0 flex-1 truncate text-left">{f.name}</span>
                    {f.state && f.state !== 'default' && <span className="shrink-0 text-2xs text-mist">{f.state}</span>}
                    {worker && <span className="size-1.5 shrink-0 animate-pulse rounded-full" style={{ background: agentColor(worker) }} />}
                    {count > 1 && (
                      <span title={`${count} variants`} className="flex shrink-0 items-center gap-0.5 text-2xs text-mist tabular-nums">
                        <LayersIcon size={11} /> {count}
                      </span>
                    )}
                  </Button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
