'use client'

import Link from 'next/link'
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { imageAccept, isBoardImage } from '@/lib/client/images'
import { Check, CloudOff, Columns2, Download, Ellipsis, GitBranch, LayoutGrid, Link2, LoaderCircle, Play, Plug, Redo2, Search, Undo2, Upload, Waypoints, type LucideIcon } from 'lucide-react'
import { agentIsOnline } from '@/lib/ops'
import type { Connection, SaveState } from '@/lib/client/useBoard'
import type { AgentPresence } from '@/lib/types'
import { LIVE_FRAMES } from '@/lib/features'
import { AgentAvatar } from './AgentAvatar'
import { ConnectDialog } from './ConnectDialog'
import { useStudio } from './studio-context'
import { IconButton, Tip, cx } from './kit'
import { Separator } from './ui/separator'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'

import { Mark } from './Mark'

function useReachable(url: string) {
  const [state, setState] = useState<'checking' | 'up' | 'down'>('checking')
  useEffect(() => {
    if (!/^https?:\/\//.test(url)) {
      const t = setTimeout(() => setState('down'), 0)
      return () => clearTimeout(t)
    }
    let alive = true
    const check = () =>
      fetch(url, { mode: 'no-cors', cache: 'no-store' })
        .then(() => alive && setState('up'))
        .catch(() => alive && setState('down'))
    const first = setTimeout(check, 400)
    const id = setInterval(check, 15_000)
    return () => {
      alive = false
      clearTimeout(first)
      clearInterval(id)
    }
  }, [url])
  return state
}

type CanvasAction = { label: string; hint: string; Icon: LucideIcon; run: () => void; accessibleLabel?: string; disabled?: boolean; keys?: string[] }

export function TopBar({ connection, saveState, onImport, placeImages, connectOpen, onConnectOpenChange, alignWidth }: {
  connection: Connection; saveState: SaveState; onImport: (json: string) => Promise<string | null>; placeImages: (files: File[]) => Promise<void>;
  connectOpen: boolean; onConnectOpenChange: (open: boolean) => void
  /** the open right panel's width: the board actions then span exactly the panel, so their edges line up */
  alignWidth?: number
}) {
  const { boardId, board, pageId, dispatch, selection, openLoupe, openSearch, openAlternates, openStateMap, confirm, toast, fit, undo, redo, history, now, play } = useStudio()
  const [address, setAddress] = useState(board.appUrl)
  const [seen, setSeen] = useState(board.appUrl)
  const fileInputId = useId()
  if (seen !== board.appUrl) {
    setSeen(board.appUrl)
    setAddress(board.appUrl)
  }
  const reach = useReachable(LIVE_FRAMES ? board.appUrl : '')
  const agents = Object.values(board.agents).filter((a) => agentIsOnline(a, now)).sort((a, b) => b.lastSeen - a.lastSeen)
  const singleInDeck = selection.length === 1 && !!board.frames.find((f) => f.id === selection[0])?.deckId
  const canCompare = selection.length === 2 || singleInDeck
  const one = selection.length === 1 ? board.frames.find((f) => f.id === selection[0]) : undefined
  const canBranch = !!one && one.kind !== 'website' && !one.shape && !one.buildOf

  const arrange = () => {
    dispatch({ type: 'sheet.arrange', pageId })
    toast('Arranged: one row per route, states left to right')
  }

  const exportBoard = () => {
    const blob = new Blob([JSON.stringify({ ...board, agents: {} }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${board.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'board'}.zeko.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    toast(`Exported ${a.download}`)
  }

  const importFile = async (f: File) => {
    const json = await f.text()
    confirm({
      title: `Import ${f.name}?`,
      body: 'This replaces every frame, comment and request on the current board. Export it first if you want to keep it.',
      confirm: 'Import',
      onConfirm: async () => {
        const error = await onImport(json)
        if (error) toast(error)
        else {
          toast('Board imported')
          setTimeout(fit, 120)
        }
      },
    })
  }

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast('Canvas link copied')
    } catch {
      toast('Couldn’t copy the link. Copy it from your address bar instead.')
    }
  }
  const canvasActions: CanvasAction[][] = [
    [
      { label: 'Arrange', hint: 'One row per route, states left to right', Icon: LayoutGrid, run: arrange },
      { label: 'Compare', hint: canCompare ? 'Compare in the loupe' : 'Select two frames, or one in a deck', keys: canCompare ? ['L'] : undefined, Icon: Columns2, run: () => openLoupe(), disabled: !canCompare },
      { label: 'Alternates', hint: canBranch ? 'See and branch versions of this frame' : 'Select one frame', keys: canBranch ? ['B'] : undefined, Icon: GitBranch, run: () => one && openAlternates(one.id), disabled: !canBranch },
      { label: 'State map', hint: 'Screens and states along the prototype links', keys: ['M'], Icon: Waypoints, run: openStateMap },
    ],
    [
      { label: 'Import', hint: 'Import a board or place images', Icon: Upload, run: () => document.getElementById(fileInputId)?.click() },
      { label: 'Export', hint: 'Download this board as a .zeko.json file', Icon: Download, run: exportBoard },
    ],
    [
      { label: 'Share', hint: 'Copy a link to this board', Icon: Link2, run: share },
      { label: 'Play', hint: 'Play the prototype', accessibleLabel: 'Play the prototype', Icon: Play, run: () => play(),
        disabled: !board.frames.some((frame) => frame.kind === 'sketch' && !!frame.html && !frame.shape) },
    ],
  ]

  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 z-20 flex items-center gap-3">
      {/* Left: the board */}
      <header className="panel pointer-events-auto flex h-10 min-w-0 items-center gap-1 px-1 sm:max-w-[44vw] xl:max-w-[38vw]">
        <Tip label="All canvases">
          <Link href="/" aria-label="All canvases" className="editor-control grid size-8 shrink-0 place-items-center focus-visible:ring-2 focus-visible:ring-ring">
            <Mark />
          </Link>
        </Tip>
        <CanvasName key={boardId} name={board.name} onRename={(name) => dispatch({ type: 'board.update', name })} />
        <CanvasConnection connection={connection} saveState={saveState} />
        <Separator orientation="vertical" className="editor-divider mx-0.5 h-4 data-vertical:self-center" />
        <div role="group" aria-label="Canvas actions" className="flex shrink-0 items-center">
          <IconButton label="Undo" keys={['⌘', 'Z']} disabled={!history.canUndo} onClick={undo}>
            <Undo2 size={15} strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Redo" keys={['⇧', '⌘', 'Z']} disabled={!history.canRedo} onClick={redo}>
            <Redo2 size={15} strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Search" keys={['⌘', 'K']} onClick={openSearch}>
            <Search size={15} strokeWidth={1.75} />
          </IconButton>
        </div>
      </header>

      {/* Center: what the agents are doing */}
      <div className="hidden min-w-0 flex-1 justify-center lg:flex">
        {agents.length > 0 && <div className="panel pointer-events-auto flex h-10 min-w-0 max-w-full items-center px-1">
          <StatusPill agents={agents} />
        </div>}
      </div>

      {/* Right: board actions */}
      <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-2" style={alignWidth && !LIVE_FRAMES ? { width: alignWidth, minWidth: 'min-content' } : undefined}>
        {LIVE_FRAMES && (
          <form
            className="panel flex h-10 w-52 items-center gap-2 px-3"
            onSubmit={(e) => {
              e.preventDefault()
              dispatch({ type: 'board.update', appUrl: address })
              ;(document.activeElement as HTMLElement | null)?.blur()
            }}
          >
            <Tip label={reach === 'up' ? 'Your app is running' : reach === 'down' ? 'Nothing answers at this address' : 'Checking your app'}>
              <span className={`size-1.5 shrink-0 rounded-full ${reach === 'up' ? 'bg-live' : reach === 'down' ? 'bg-grease' : 'bg-mist'}`} />
            </Tip>
            <Input
              aria-label="Your app’s address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onBlur={() => address !== board.appUrl && dispatch({ type: 'board.update', appUrl: address })}
              placeholder="http://localhost:3000"
              className="min-w-0 flex-1 bg-transparent font-mono text-2xs text-slate outline-none placeholder:text-mist focus:text-ink"
            />
          </form>
        )}
        {alignWidth && !LIVE_FRAMES
          ? <FittedActions groups={[canvasActions[0]!, canvasActions[2]!]} menu={[canvasActions[1]!]} className="hidden min-w-0 flex-1 sm:flex" />
          : <Group className="hidden sm:flex">
              {[canvasActions[0]!, canvasActions[2]!].map((group, index) => (
                <Fragment key={group[0]!.label}>
                  {index > 0 && <ToolbarDivider />}
                  {group.map((action) => <ActionButton key={action.label} action={action} />)}
                </Fragment>
              ))}
              <ToolbarDivider />
              <Tip label="More board actions"><ActionsMenu groups={[canvasActions[1]!]} label="More board actions" /></Tip>
            </Group>}
        <Group className="sm:hidden">
          <ActionsMenu groups={canvasActions} label="Board actions" />
        </Group>
        <input
          id={fileInputId}
          type="file"
          aria-label="Import a board or images"
          accept={`.json,application/json,${imageAccept}`}
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? [])
            e.target.value = ''
            if (!files.length) return
            if (files.every(isBoardImage)) void placeImages(files)
            else if (files.length === 1 && (files[0]!.type === 'application/json' || /\.json$/i.test(files[0]!.name))) void importFile(files[0]!)
            else toast('Choose image files or one .zeko.json board.')
          }}
        />
        <ConnectDialog open={connectOpen} onOpenChange={onConnectOpenChange}
          agents={Object.values(board.agents)} now={now} canvas={{ id: boardId, name: board.name }}
          trigger={
            <Button variant="ghost" aria-label="MCP connection" className="editor-control editor-primary h-10 font-semibold">
              <Plug data-icon="inline-start" aria-hidden /> <span className="hidden sm:inline">Connect MCP</span>
            </Button>
          } />
      </div>
    </div>
  )
}

function CanvasName({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!editing) return
    input.current?.focus()
    input.current?.select()
  }, [editing])

  if (editing) {
    return (
      <Input
        ref={input}
        aria-label="Board name"
        defaultValue={name}
        className="w-52 min-w-0"
        onBlur={(event) => {
          const value = event.currentTarget.value.trim()
          setEditing(false)
          if (value && value !== name) onRename(value)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          if (event.key === 'Escape') event.currentTarget.value = name
          event.currentTarget.blur()
          requestAnimationFrame(() => trigger.current?.focus())
        }}
      />
    )
  }

  return (
    <Tip label="Rename canvas">
      <Button ref={trigger} variant="ghost" aria-label={`Rename canvas: ${name}`} onClick={() => setEditing(true)} className="min-w-0 max-w-52 shrink justify-start px-2">
        <span className="truncate">{name}</span>
      </Button>
    </Tip>
  )
}

function CanvasConnection({ connection, saveState }: { connection: Connection; saveState: SaveState }) {
  const failed = saveState === 'failed'
  const live = connection === 'live' && saveState === 'idle'
  const loading = saveState === 'saving' || connection === 'connecting'
  const label = failed ? 'A canvas change couldn’t be saved' : saveState === 'saving' ? 'Saving canvas…'
    : live ? 'Canvas connected' : loading ? 'Connecting to canvas…' : 'Reconnecting to canvas…'
  const Icon = failed ? CloudOff : live ? Check : loading ? LoaderCircle : CloudOff

  return (
    <Tip label={label}>
      <span role="status" className={cx('grid size-5 shrink-0 place-items-center', !failed && (live || loading) ? 'text-slate' : 'text-grease')}>
        <Icon aria-hidden size={13} strokeWidth={1.75} className={!failed && loading ? 'motion-safe:animate-spin' : undefined} />
        <span className="sr-only">{label}</span>
      </span>
    </Tip>
  )
}

function ActionButton({ action, labelled }: { action: CanvasAction; labelled?: boolean }) {
  const { Icon, label, accessibleLabel, hint, keys, run, disabled } = action
  return (
    <Tip label={hint} keys={keys}>
      <GroupButton label={label} labelled={labelled} aria-label={accessibleLabel ?? label} onClick={run} disabled={disabled}>
        <Icon data-icon="inline-start" aria-hidden />
      </GroupButton>
    </Tip>
  )
}

function ActionsMenu({ groups, label }: { groups: CanvasAction[][]; label: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={label} />}>
        <Ellipsis aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {groups.map((group, index) => (
          <Fragment key={group[0]!.label}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              {group.map(({ Icon, label: name, accessibleLabel, run, disabled }) => (
                <DropdownMenuItem key={name} disabled={disabled} onClick={run}>
                  <Icon aria-hidden /> {accessibleLabel ?? name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const DIVIDER_WIDTH = 9 // 1px line with 4px on each side
const BUTTON_GAP = 2

/**
 * Board actions in the width of the side panel, with `menu` (Import, Export) always under "More" and every other
 * action always in the bar, labelled from the first action for as many as fit, the rest as icons. When even the icons don't
 * fit, the bar keeps its icons and grows past the panel's edge rather than hiding any of them.
 */
function FittedActions({ groups, menu, className }: { groups: CanvasAction[][]; menu: CanvasAction[][]; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const ruler = useRef<HTMLDivElement>(null)
  // labelled: how many actions, from the first, show labels; least: the width of the bar with only icons.
  const [fit, setFit] = useState({ labelled: 0, least: 0 })
  const flat = groups.flatMap((group, groupIndex) => group.map((action) => ({ action, groupIndex })))
  const signature = [...flat.map(({ action }) => action.label), ...menu.flat().map((action) => action.label)].join('|')

  useLayoutEffect(() => {
    const container = box.current
    const measure = ruler.current
    if (!container || !measure) return
    const update = () => {
      const style = getComputedStyle(container)
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      const room = container.clientWidth - padding
      const labelled = [...measure.querySelectorAll<HTMLElement>('[data-measure="labelled"]')].map((el) => el.offsetWidth)
      const icons = [...measure.querySelectorAll<HTMLElement>('[data-measure="icon"]')].map((el) => el.offsetWidth)
      const more = measure.querySelector<HTMLElement>('[data-measure="more"]')?.offsetWidth ?? 32
      const span = (count: number) => flat.reduce((total, item, i) =>
        total + (i > 0 ? BUTTON_GAP + (item.groupIndex !== flat[i - 1]!.groupIndex ? DIVIDER_WIDTH : 0) : 0)
          + (i < count ? labelled[i]! : icons[i]!), 0) + BUTTON_GAP + DIVIDER_WIDTH + more
      let count = flat.length
      while (count > 0 && span(count) > room) count--
      setFit({ labelled: count, least: Math.ceil(span(0) + padding) })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
    // The labels decide the widths; re-measure when the set of actions changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  return (
    <div ref={box} style={fit.least ? { minWidth: fit.least } : undefined} className={cx('panel relative h-10 items-center gap-0.5 overflow-hidden px-1', className)}>
      {flat.map(({ action, groupIndex }, index) => (
        <Fragment key={action.label}>
          {index > 0 && flat[index - 1]!.groupIndex !== groupIndex && <ToolbarDivider />}
          <ActionButton action={action} labelled={index < fit.labelled} />
        </Fragment>
      ))}
      <ToolbarDivider />
      <Tip label="More board actions"><ActionsMenu groups={menu} label="More board actions" /></Tip>
      <div ref={ruler} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex" inert>
        {flat.map(({ action }) => (
          <Fragment key={action.label}>
            <span data-measure="labelled" className="flex"><GroupButton label={action.label} labelled tabIndex={-1}><action.Icon data-icon="inline-start" /></GroupButton></span>
            <span data-measure="icon" className="flex"><GroupButton label={action.label} labelled={false} tabIndex={-1}><action.Icon data-icon="inline-start" /></GroupButton></span>
          </Fragment>
        ))}
        <span data-measure="more" className="flex"><Button variant="ghost" size="icon" tabIndex={-1}><Ellipsis /></Button></span>
      </div>
    </div>
  )
}

function ToolbarDivider() {
  return <Separator orientation="vertical" className="editor-divider mx-1 h-4 data-vertical:self-center" />
}

function Group({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('panel flex h-10 items-center gap-0.5 px-1', className)}>{children}</div>
}

function GroupButton({ children, label, labelled, className, ...props }: Omit<React.ComponentProps<typeof Button>, 'className'> & { label: string; labelled?: boolean; className?: string }) {
  return (
    <Button
      variant="ghost"
      aria-label={label}
      {...props}
      className={cx('px-2', className)}
    >
      {children}
      <span aria-hidden className={labelled === undefined ? 'hidden xl:inline' : labelled ? 'inline' : 'hidden'}>{label}</span>
    </Button>
  )
}

function StatusPill({ agents }: { agents: AgentPresence[] }) {
  const shown = agents[0]
  if (!shown) return null
  return (
    <div className="flex h-8 max-w-[420px] min-w-0 items-center gap-2 pr-2.5 pl-1">
      <div className="flex shrink-0 items-center -space-x-1">
        {agents.map((a) => (
          <span key={a.name} title={a.name} className="rounded-md bg-lightbox ring-1 ring-lightbox">
            <AgentAvatar name={a.name} />
          </span>
        ))}
      </div>
      <span role="status" className="flex min-w-0 items-center gap-1.5 text-xs">
        <span className="size-1.5 shrink-0 rounded-full bg-live" />
        <span className="shrink-0 font-medium">{shown.name}</span>
        <span className="truncate text-slate">{agents.length > 1 ? `and ${agents.length - 1} more online` : 'online'}</span>
      </span>
    </div>
  )
}
