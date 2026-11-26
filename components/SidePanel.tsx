'use client'

import { useRef, useState } from 'react'
import { Activity as ActivityIcon, ArrowLeft, BookOpen, ChevronRight, MessageSquare, MessageSquarePlus, Sparkles, SlidersHorizontal, X, type LucideIcon } from 'lucide-react'
import { framePage } from '@/lib/ops'
import { ago } from '@/lib/client/useBoard'
import { FrameInspector } from './FrameInspector'
import { MemoryPanel } from './MemoryPanel'
import { AgentChat } from './AgentChat'
import { Button, IconButton, Kbd, Tip, cx } from './kit'
import { Button as ActionButton } from './ui/button'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { CommentThread, Face } from './FrameComments'
import { SIDE_PANEL, useStudio } from './studio-context'

type Tab = 'agents' | 'comments' | 'activity' | 'memory'

const TABS: { id: Tab; label: string; Icon: LucideIcon }[] = [
  { id: 'agents', label: 'Agents', Icon: Sparkles },
  { id: 'comments', label: 'Comments', Icon: MessageSquare },
  { id: 'activity', label: 'Activity', Icon: ActivityIcon },
  { id: 'memory', label: 'Memory', Icon: BookOpen },
]

interface SidePanelProps {
  agentPanelRequest: number
  width: number
  maxWidth: number
  closed: boolean
  onClosedChange: (closed: boolean) => void
  onResize: (width: number) => void
}

export function DesignPanel({ open, right, width, overlay, onOpenChange }: {
  open: boolean
  right: number
  width: number
  overlay: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!open) {
    return (
      <div className="panel absolute top-14 z-10 p-1" style={{ right }}>
        <IconButton label="Show Design inspector" side="left" aria-expanded={false} aria-controls="studio-design-panel" onClick={() => onOpenChange(true)}>
          <SlidersHorizontal size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
    )
  }

  return (
    <aside id="studio-design-panel" aria-label="Design inspector" className={cx('panel right-panel fade-in absolute top-14 z-20 flex max-w-[calc(100%-16px)] flex-col overflow-hidden', overlay ? 'bottom-[min(220px,45%)]' : 'bottom-2')} style={{ right, width }}>
      <header className="editor-divider flex h-11 shrink-0 items-center justify-between border-b px-3.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal size={15} strokeWidth={1.75} aria-hidden /> Design</h2>
        <IconButton label="Close Design inspector" onClick={() => onOpenChange(false)} className="size-7"><X size={15} strokeWidth={1.75} /></IconButton>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden"><FrameInspector /></div>
    </aside>
  )
}

export function SidePanel({ agentPanelRequest, width, maxWidth, closed, onClosedChange, onResize }: SidePanelProps) {
  const { board, pageId } = useStudio()
  const [selection, setSelection] = useState<{ tab: Tab; request: number }>({ tab: 'agents', request: 0 })
  const tab = selection.request === agentPanelRequest ? selection.tab : 'agents'
  const resizeStart = useRef<{ x: number; width: number } | null>(null)
  const openTasks = board.tasks.filter((t) => t.status !== 'done').length
  const openComments = board.comments.filter((c) => !c.resolved && board.frames.some((f) => f.id === c.frameId && framePage(board, f) === pageId)).length
  const counts: Partial<Record<Tab, number>> = { agents: openTasks, comments: openComments }
  const show = (next: Tab) => {
    onClosedChange(false)
    setSelection({ tab: next, request: agentPanelRequest })
  }

  return (
    <>
      {closed && (
        <div role="group" aria-label="Right panel shortcuts" className="panel absolute top-14 right-2 z-10 flex flex-col gap-0.5 p-1">
          {TABS.map(({ id, label, Icon }) => (
            <IconButton key={id} label={label} side="left" onClick={() => show(id)} aria-controls="studio-side-panel" aria-expanded={false} className="relative">
              <Icon size={15} strokeWidth={1.75} />
              {!!counts[id] && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-grease" />}
            </IconButton>
          ))}
        </div>
      )}
      <div className="pointer-events-none absolute top-14 right-2 bottom-2 z-10 flex flex-col" style={{ width }}>
        <aside hidden={closed} id="studio-side-panel" aria-label="Right panel" className="panel right-panel pointer-events-auto relative flex min-h-0 flex-1 flex-col">
          <Tabs value={tab} onValueChange={(value) => show(value as Tab)} className="min-h-0 flex-1 gap-0 overflow-hidden rounded-[inherit]">
            <div className="editor-divider flex h-11 shrink-0 items-center justify-between gap-1 border-b px-2">
              <TabsList variant="line" activateOnFocus aria-label="Right panel views" className="editor-tabs min-w-0">
                {TABS.map(({ id, label, Icon }) => (
                  <Tip key={id} label={counts[id] ? `${label} · ${counts[id]} open` : label} side="left">
                    <TabsTrigger aria-label={label} value={id} className="editor-control editor-tab group">
                      <Icon size={15} strokeWidth={1.75} aria-hidden />
                      <span aria-hidden className="hidden group-data-active:inline">{label}</span>
                    </TabsTrigger>
                  </Tip>
                ))}
              </TabsList>
              <IconButton label="Close the panel" onClick={() => onClosedChange(true)} className="size-7 shrink-0">
                <X size={15} strokeWidth={1.75} />
              </IconButton>
            </div>
            <TabsContent value="agents" keepMounted className="flex min-h-0 flex-col">
              <AgentChat />
            </TabsContent>
            <TabsContent value="comments" keepMounted className="min-h-0 overflow-auto"><CommentsTab /></TabsContent>
            <TabsContent value="activity" className="min-h-0 overflow-auto"><ActivityTab /></TabsContent>
            <TabsContent value="memory" className="min-h-0 overflow-auto"><MemoryPanel /></TabsContent>
          </Tabs>
          <div
            role="separator"
            tabIndex={0}
            aria-label="Resize right panel"
            aria-orientation="vertical"
            aria-controls="studio-side-panel"
            aria-valuemin={SIDE_PANEL.minWidth}
            aria-valuemax={maxWidth}
            aria-valuenow={width}
            aria-valuetext={`${width} pixels`}
            className="group absolute inset-y-0 left-0 z-10 flex w-3 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center rounded-lg outline-none select-none transition-colors hover:bg-ink/5 focus-visible:ring-1 focus-visible:ring-grease active:bg-ink/10"
            onPointerDown={(e) => {
              if (e.button !== 0 || !e.isPrimary) return
              resizeStart.current = { x: e.clientX, width }
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              const start = resizeStart.current
              if (start && e.currentTarget.hasPointerCapture(e.pointerId)) onResize(start.width + start.x - e.clientX)
            }}
            onLostPointerCapture={() => {
              resizeStart.current = null
            }}
            onKeyDown={(e) => {
              let next: number
              switch (e.key) {
                case 'ArrowLeft':
                  next = width + 16
                  break
                case 'ArrowRight':
                  next = width - 16
                  break
                case 'Home':
                  next = SIDE_PANEL.minWidth
                  break
                case 'End':
                  next = maxWidth
                  break
                default:
                  return
              }
              e.preventDefault()
              e.stopPropagation()
              onResize(next)
            }}
          >
            <span className="h-9 w-0.5 rounded-full bg-slate/35 transition-colors group-hover:bg-slate group-focus-visible:bg-grease group-active:bg-grease" />
          </div>
        </aside>
      </div>
    </>
  )
}

function PanelHeading({ title }: { title: string }) {
  return (
    <h3 className="mb-2 flex min-h-6 items-center text-sm font-semibold">{title}</h3>
  )
}

function QuietState({ icon, title, body }: { icon: React.ReactNode; title: string; body: React.ReactNode }) {
  return (
    <div className="inspector-card flex min-w-0 flex-col items-start gap-1.5 p-3">
      <span className="mb-0.5 grid size-8 place-items-center rounded-lg bg-wash text-slate">{icon}</span>
      <p className="font-medium">{title}</p>
      <p className="text-xs leading-relaxed text-slate">{body}</p>
    </div>
  )
}

function ActivityTab() {
  const { board, now } = useStudio()
  const byDay = new Map<string, typeof board.activity>()
  const today = new Date(now).toDateString()
  for (const entry of board.activity) {
    const date = new Date(entry.at)
    const day = date.toDateString() === today ? 'Today' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    const entries = byDay.get(day)
    if (entries) entries.push(entry)
    else byDay.set(day, [entry])
  }
  return (
    <div className="editor-content flex flex-col gap-4 p-3">
      {!byDay.size && <QuietState icon={<ActivityIcon size={16} />} title="No activity yet" body="Changes people and agents make to this canvas will appear here." />}
      {[...byDay].map(([day, entries]) => (
        <section key={day}>
          <PanelHeading title={day} />
          <ol className="ml-2.5 flex flex-col gap-3 border-l border-hair">
            {entries.map((entry) => (
              <li key={entry.id} className="relative flex min-w-0 items-start gap-2 pl-5">
                <span className="absolute top-0 -left-2.5 rounded-full bg-[var(--inspector-bg)] ring-2 ring-[var(--inspector-bg)]"><Face actor={entry.actor} size={20} /></span>
                <p className="min-w-0 flex-1 text-sm leading-relaxed wrap-anywhere">
                  <span className="font-medium">{entry.actor.name}</span> <span className="text-slate">{entry.text}</span>
                </p>
                <time dateTime={new Date(entry.at).toISOString()} className="shrink-0 pt-1 text-2xs text-slate">{ago(entry.at, now)}</time>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

function CommentsTab() {
  const { board, pageId, now, tool, select, flyTo, openThread, threadInPanel, setOpenThread, setTool, setInteractId } = useStudio()
  const [resolvedOnly, setResolvedOnly] = useState(false)
  const comments = board.comments.flatMap((comment) => {
    const frame = board.frames.find((item) => item.id === comment.frameId)
    return frame && framePage(board, frame) === pageId ? [{ comment, frame }] : []
  })
  const resolved = comments.filter(({ comment }) => comment.resolved).length
  const list = comments.filter(({ comment }) => comment.resolved === resolvedOnly).sort((a, b) => b.comment.at - a.comment.at)
  const active = threadInPanel ? comments.find(({ comment }) => comment.id === openThread) : undefined
  if (active) {
    return (
      <div className="editor-content flex flex-col gap-2.5 p-3">
        <Button size="sm" variant="ghost" className="self-start" onClick={() => setOpenThread(null)}><ArrowLeft size={14} /> All comments</Button>
        <h3 className="truncate px-1 text-sm font-semibold" title={active.frame.name}>{active.frame.name}</h3>
        <CommentThread key={active.comment.id} comment={active.comment} docked />
      </div>
    )
  }
  return (
    <div className="editor-content flex flex-col gap-3 p-3">
      <div className="flex min-w-0 items-center gap-1 rounded-lg border border-hair bg-table/50 p-1">
        <ToggleGroup aria-label="Comment status" size="sm" value={[resolvedOnly ? 'resolved' : 'open']} className="min-w-0 flex-1"
          onValueChange={([status]) => { if (status) setResolvedOnly(status === 'resolved') }}>
          <ToggleGroupItem value="open" className="flex-1">Open · {comments.length - resolved}</ToggleGroupItem>
          <ToggleGroupItem value="resolved" className="flex-1">Resolved · {resolved}</ToggleGroupItem>
        </ToggleGroup>
        <IconButton label="Add comment" keys={['C']} active={tool === 'comment'} onClick={() => { setResolvedOnly(false); setTool('comment') }} className="size-7">
          <MessageSquarePlus size={15} />
        </IconButton>
      </div>
      {tool === 'comment' && <p role="status" className="rounded-md bg-grease-soft px-2.5 py-2 text-xs text-ink">Click a frame to place a comment.</p>}
      {list.length === 0 ? (
        <QuietState icon={<MessageSquare size={16} />} title={resolvedOnly ? 'No resolved comments' : 'No open comments'} body={resolvedOnly ? 'Resolved threads from this page will appear here.' : <>Press <Kbd>C</Kbd> and click a frame to leave a comment.</>} />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map(({ comment, frame }) => (
            <li key={comment.id}>
              <ActionButton variant="ghost"
                onClick={() => {
                  setTool('select')
                  setInteractId(null)
                  select([frame.id])
                  flyTo(frame)
                  setOpenThread(comment.id, 'panel')
                }}
                className="inspector-card flex h-auto w-full min-w-0 justify-start whitespace-normal items-start gap-2.5 px-2.5 py-2.5 text-left transition-colors hover:bg-wash"
              >
                <Face actor={comment.author} size={22} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                    <span className="truncate font-medium">{comment.author.name}</span>
                    <span className="text-2xs text-slate">{ago(comment.at, now)}</span>
                    {comment.forAgents && <span className="text-2xs text-[#ff8ba2]">For agents</span>}
                  </span>
                  <span className="mt-1 line-clamp-2 text-sm leading-snug wrap-anywhere">{comment.text}</span>
                  <span className="mt-1.5 block truncate text-2xs text-slate">
                    {frame.name}{comment.replies.length > 0 && ` · ${comment.replies.length} ${comment.replies.length === 1 ? 'reply' : 'replies'}`}
                  </span>
                </span>
                <ChevronRight size={14} className="mt-1 shrink-0 text-slate" />
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
