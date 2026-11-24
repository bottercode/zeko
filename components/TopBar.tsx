'use client'

import Link from 'next/link'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { imageAccept, isBoardImage } from '@/lib/client/images'
import { Check, CloudOff, Columns2, Download, Ellipsis, LayoutGrid, Link2, LoaderCircle, Play, Plug, Redo2, Search, Undo2, Upload, type LucideIcon } from 'lucide-react'
import { agentIsOnline } from '@/lib/ops'
import type { Connection } from '@/lib/client/useBoard'
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

export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden>
      <rect x="1" y="3.5" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" strokeOpacity=".55" strokeWidth="1.5" transform="rotate(-6 7 9)" />
      <rect x="5" y="3.5" width="12" height="11" rx="1.5" fill="var(--color-lightbox)" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="13.6" cy="7" r="1.7" fill="var(--color-grease)" />
    </svg>
  )
}

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

export function TopBar({ connection, onImport, placeImages, connectOpen, onConnectOpenChange }: {
  connection: Connection; onImport: (json: string) => Promise<string | null>; placeImages: (files: File[]) => Promise<void>;
  connectOpen: boolean; onConnectOpenChange: (open: boolean) => void
}) {
  const { boardId, board, pageId, dispatch, selection, openLoupe, openSearch, confirm, toast, fit, undo, redo, history, now, play } = useStudio()
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
    await navigator.clipboard.writeText(window.location.href).catch(() => undefined)
    toast('Link copied. It opens on this computer, or on others that can reach this address')
  }
  const canvasActions: { label: string; hint: string; Icon: LucideIcon; run: () => void; accessibleLabel?: string; disabled?: boolean; keys?: string[] }[][] = [
    [
      { label: 'Arrange', hint: 'One row per route, states left to right', Icon: LayoutGrid, run: arrange },
      { label: 'Compare', hint: canCompare ? 'Compare in the loupe' : 'Select two frames, or one in a deck', keys: canCompare ? ['L'] : undefined, Icon: Columns2, run: () => openLoupe(), disabled: !canCompare },
    ],
    [
      { label: 'Import', hint: 'Import a board or place images', Icon: Upload, run: () => document.getElementById(fileInputId)?.click() },
      { label: 'Export', hint: 'Download this board as a .zeko.json file', Icon: Download, run: exportBoard },
    ],
    [
      { label: 'Share', hint: 'Copy a link to this board', Icon: Link2, run: share },
      { label: 'Play', hint: 'Play the prototype', accessibleLabel: 'Play the prototype', Icon: Play, run: () => play() },
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
        <CanvasConnection connection={connection} />
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
        <div className="panel pointer-events-auto flex h-10 min-w-0 max-w-full items-center px-1">
          <StatusPill agents={agents} />
        </div>
      </div>

      {/* Right: board actions */}
      <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-2">
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
        <Group className="hidden sm:flex">
          {canvasActions.map((group, index) => (
            <Fragment key={group[0]!.label}>
              {index > 0 && <ToolbarDivider />}
              {group.map(({ Icon, label, accessibleLabel, hint, keys, run, disabled }) => (
                <Tip key={label} label={hint} keys={keys}>
                  <GroupButton label={label} aria-label={accessibleLabel ?? label} onClick={run} disabled={disabled}>
                    <Icon data-icon="inline-start" aria-hidden />
                  </GroupButton>
                </Tip>
              ))}
            </Fragment>
          ))}
        </Group>
        <Group className="sm:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Board actions" />}>
              <Ellipsis aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {canvasActions.map((group, index) => (
                <Fragment key={group[0]!.label}>
                  {index > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuGroup>
                    {group.map(({ Icon, label, accessibleLabel, run, disabled }) => (
                      <DropdownMenuItem key={label} disabled={disabled} onClick={run}>
                        <Icon aria-hidden /> {accessibleLabel ?? label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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

function CanvasConnection({ connection }: { connection: Connection }) {
  const live = connection === 'live'
  const connecting = connection === 'connecting'
  const label = live ? 'Canvas connected' : connecting ? 'Connecting to canvas' : 'Reconnecting to canvas'
  const Icon = live ? Check : connecting ? LoaderCircle : CloudOff

  return (
    <Tip label={label}>
      <span role="status" className={cx('grid size-5 shrink-0 place-items-center', live || connecting ? 'text-slate' : 'text-grease')}>
        <Icon aria-hidden size={13} strokeWidth={1.75} className={connecting ? 'motion-safe:animate-spin' : undefined} />
        <span className="sr-only">{label}</span>
      </span>
    </Tip>
  )
}

function ToolbarDivider() {
  return <Separator orientation="vertical" className="editor-divider mx-1 h-4 data-vertical:self-center" />
}

function Group({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('panel flex h-10 items-center gap-0.5 px-1', className)}>{children}</div>
}

function GroupButton({ children, label, className, ...props }: Omit<React.ComponentProps<typeof Button>, 'className'> & { label: string; className?: string }) {
  return (
    <Button
      variant="ghost"
      aria-label={label}
      {...props}
      className={cx('px-2', className)}
    >
      {children}
      <span aria-hidden className="hidden xl:inline">{label}</span>
    </Button>
  )
}

function StatusPill({ agents }: { agents: AgentPresence[] }) {
  const shown = agents[0]
  return (
    <div className="flex h-8 max-w-[420px] min-w-0 items-center gap-2 pr-2.5 pl-1">
      <div className="flex shrink-0 items-center -space-x-1">
        <span className="grid size-5 place-items-center rounded-full border-[1.5px] border-lightbox bg-ink text-[9px] font-semibold text-on-ink">Y</span>
        {agents.map((a) => (
          <span key={a.name} title={a.name} className="rounded-md bg-lightbox ring-1 ring-lightbox">
            <AgentAvatar name={a.name} />
          </span>
        ))}
      </div>
      {shown ? (
        <span role="status" className="flex min-w-0 items-center gap-1.5 text-xs">
          <span className="size-1.5 shrink-0 rounded-full bg-live" />
          <span className="shrink-0 font-medium">{shown.name}</span>
          <span className="truncate text-slate">{agents.length > 1 ? `and ${agents.length - 1} more online` : 'online'}</span>
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-slate">
          <span className="size-1.5 shrink-0 rounded-full bg-mist" /> <span className="truncate">No agent on the board</span>
        </span>
      )}
    </div>
  )
}
