'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowUp,
  Copy,
  FolderOpen,
  Hourglass,
  LayoutGrid,
  List,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plug,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { acpAgent, type AcpAgentId } from '@/lib/acp'
import { agentIsOnline } from '@/lib/ops'
import { SAMPLE_ID } from '@/lib/seed'
import { ago, useNow } from '@/lib/client/useBoard'
import { AgentAvatar } from './AgentAvatar'
import { ConnectDialog } from './ConnectDialog'
import { ChoiceSelect } from './ChoiceSelect'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupTextarea } from './ui/input-group'
import { Skeleton } from './ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { Mark } from './TopBar'
import { AcpAgentPicker, useAcpAgents } from './AcpComposerOptions'
import { ConfirmDialog, Menu, Tip, ToastProvider, cx, useToast, type MenuItem } from './kit'

interface Canvas {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  frames: number
  openTasks: number
  agents: string[]
  cover: { html: string; w: number; h: number } | null
}
interface SeenAgent {
  name: string
  lastSeen: number
  connectedAt?: number
  mcpConnectedAt?: number
  companion?: boolean
  canvas: string
}

type Sort = 'edited' | 'created' | 'name'
type View = 'all' | 'waiting'

const IDEAS = [
  'A pricing page with three plans and a yearly toggle',
  'A three-step onboarding flow for a new account',
  'A settings screen: profile, notifications and billing',
  'Empty, loading and error states for a dashboard',
  'A mobile checkout with saved cards',
]
const IDEA_LABELS = ['Pricing page', 'Onboarding flow', 'Settings screen', 'Empty and error states', 'Mobile checkout']

export function Home() {
  return (
    <ToastProvider>
      <HomeInner />
    </ToastProvider>
  )
}

function HomeInner() {
  const router = useRouter()
  const toast = useToast()
  const now = useNow()
  const [canvases, setCanvases] = useState<Canvas[] | null>(null)
  const [presence, setPresence] = useState<SeenAgent[]>([])
  const [offline, setOffline] = useState(false)
  const [sidebar, setSidebar] = useState(true)
  const [view, setView] = useState<View>('all')
  const [sort, setSort] = useState<Sort>('edited')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [filter, setFilter] = useState('')
  const [connectOpen, setConnectOpen] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; items: (MenuItem | 'divider')[] } | null>(null)
  const [confirm, setConfirm] = useState<{ title: string; body: string; confirm: string; onConfirm: () => void } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    try {
      const res = await fetch('/api/boards', { cache: 'no-store' })
      const data = (await res.json()) as { canvases: Canvas[] }
      setCanvases(data.canvases)
      setOffline(false)
    } catch {
      setOffline(true)
    }
  }
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })
  // Refresh canvas summaries. Agent presence arrives separately as it changes.
  useEffect(() => {
    const first = setTimeout(() => void loadRef.current(), 0)
    const id = setInterval(() => void loadRef.current(), 5000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [])

  useEffect(() => {
    const source = new EventSource('/api/boards/events')
    source.onmessage = (event) => setPresence(JSON.parse(event.data) as SeenAgent[])
    return () => source.close()
  }, [])

  const create = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/boards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
    if (!res.ok || !data.id) {
      toast(data.error ?? 'Couldn’t make the canvas.')
      return
    }
    router.push(`/c/${data.id}`)
  }

  const importFile = async (f: File) => {
    try {
      await create({ board: JSON.parse(await f.text()) })
    } catch {
      toast('That file isn’t valid JSON.')
    }
  }

  const rename = async (c: Canvas, name: string) => {
    setRenaming(null)
    if (!name.trim() || name.trim() === c.name) return
    setCanvases((list) => list?.map((x) => (x.id === c.id ? { ...x, name: name.trim() } : x)) ?? null)
    await fetch(`/api/boards/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    void load()
  }

  const cardMenu = (c: Canvas, x: number, y: number) =>
    setMenu({
      x,
      y,
      items: [
        { label: 'Open', icon: <FolderOpen size={14} />, onSelect: () => router.push(`/c/${c.id}`) },
        { label: 'Rename', icon: <Pencil size={14} />, onSelect: () => setRenaming(c.id) },
        {
          label: 'Duplicate',
          icon: <Copy size={14} />,
          onSelect: async () => {
            await fetch(`/api/boards/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ duplicate: true }) })
            toast(`Duplicated ${c.name}`)
            void load()
          },
        },
        ...(c.id === SAMPLE_ID
          ? [{ label: 'Create a fresh sample', icon: <Plus size={14} />, onSelect: () => void create({ sample: true, name: 'Fernway pricing copy' }) }]
          : []),
        'divider',
        {
          label: 'Delete',
          icon: <Trash2 size={14} />,
          danger: true,
          onSelect: () =>
            setConfirm({
              title: `Delete ${c.name}?`,
              body: 'It leaves this list. A copy stays in the .zeko/trash folder if you need it back.',
              confirm: 'Delete canvas',
              onConfirm: async () => {
                setCanvases((list) => list?.filter((x) => x.id !== c.id) ?? null)
                await fetch(`/api/boards/${c.id}`, { method: 'DELETE' })
                toast(`Deleted ${c.name}`)
                void load()
              },
            }),
        },
      ],
    })

  const latestByName = new Map<string, SeenAgent>()
  const onlineByCanvas = new Map<string, string[]>()
  for (const agent of presence) {
    if (!latestByName.has(agent.name)) latestByName.set(agent.name, agent)
    if (agentIsOnline(agent, now)) {
      const online = onlineByCanvas.get(agent.canvas)
      if (online) online.push(agent.name)
      else onlineByCanvas.set(agent.canvas, [agent.name])
    }
  }
  const agents = [...latestByName.values()]
  const q = filter.trim().toLowerCase()
  const shown = (canvases ?? [])
    .map((canvas) => ({ ...canvas, agents: onlineByCanvas.get(canvas.id) ?? [] }))
    .filter((c) => (view === 'waiting' ? c.openTasks > 0 : true))
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt))
  const waiting = (canvases ?? []).filter((c) => c.openTasks > 0).length

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      {sidebar ? (
        <aside className="flex w-[232px] shrink-0 flex-col border-r border-hair-soft bg-lightbox">
          <div className="flex h-14 items-center gap-2 pr-2 pl-4">
            <Mark size={20} />
            <span className="flex-1 font-semibold tracking-tight">zeko</span>
            <Tip label="Search canvases">
              <button aria-label="Search canvases" onClick={() => filterRef.current?.focus()} className="grid size-7 place-items-center rounded-md text-mist hover:bg-wash hover:text-ink">
                <Search size={14} />
              </button>
            </Tip>
            <Tip label="Hide the sidebar">
              <button aria-label="Hide the sidebar" onClick={() => setSidebar(false)} className="grid size-7 place-items-center rounded-md text-mist hover:bg-wash hover:text-ink">
                <PanelLeftClose size={14} />
              </button>
            </Tip>
          </div>
          <nav className="px-2">
            <SideItem icon={<LayoutGrid size={14} />} active={view === 'all'} onClick={() => setView('all')} count={canvases?.length}>
              All canvases
            </SideItem>
            <SideItem icon={<Hourglass size={14} />} active={view === 'waiting'} onClick={() => setView('waiting')} count={waiting || undefined}>
              Waiting on agents
            </SideItem>
          </nav>

          <p className="mt-5 px-4 pb-1 text-2xs text-mist">Agents</p>
          <ul className="px-2">
            {agents.slice(0, 8).map((a) => {
              const on = agentIsOnline(a, now)
              return (
                <li key={a.name}>
                  <Link href={`/c/${a.canvas}`} className="flex h-8 items-center gap-2 rounded-md px-2.5 text-sm text-ink/85 hover:bg-wash hover:text-ink">
                    <span className="relative shrink-0">
                      <AgentAvatar name={a.name} />
                      {on && <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-live ring-2 ring-lightbox" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    <span className="shrink-0 text-2xs text-mist">{on ? a.connectedAt ? 'Connected' : 'Here' : now ? ago(a.lastSeen, now) : ''}</span>
                  </Link>
                </li>
              )
            })}
            <li>
              <button onClick={() => setConnectOpen(true)} className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-sm text-slate hover:bg-wash hover:text-ink">
                <Plug size={14} className="shrink-0" /> MCP connection
              </button>
            </li>
          </ul>

          <div className="mt-auto border-t border-hair-soft p-3">
            <div className="flex items-center gap-2.5">
              <span className="grid size-7 place-items-center rounded-full bg-[#5b6cff] text-xs font-semibold text-white">Y</span>
              <div className="min-w-0">
                <p className="text-sm">You</p>
                <p className="truncate text-2xs text-mist">Saved on this computer</p>
              </div>
            </div>
          </div>
        </aside>
      ) : (
        <div className="absolute top-3 left-3 z-10">
          <Tip label="Show the sidebar" side="right">
            <button aria-label="Show the sidebar" onClick={() => setSidebar(true)} className="panel grid size-9 place-items-center text-slate hover:text-ink">
              <PanelLeftOpen size={15} />
            </button>
          </Tip>
        </div>
      )}

      {/* Main */}
      <main className="relative min-w-0 flex-1 overflow-auto">
        <div className="absolute top-3 right-4 z-10 flex items-center gap-2">
          <Button variant="outline" size="lg" onClick={() => file.current?.click()}><Upload data-icon="inline-start" aria-hidden /> Import</Button>
          <Button size="lg" onClick={() => void create({})}><Plus data-icon="inline-start" aria-hidden /> New canvas</Button>
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void importFile(f)
            }}
          />
        </div>

        <Hero onCreate={create} />

        {/* Canvases */}
        <section className="mx-auto max-w-[1180px] px-8 pb-16">
          <div className="mb-4 flex items-center gap-3">
            <h2 className="text-[15px] font-semibold">{view === 'waiting' ? 'Waiting on agents' : 'Canvases'}</h2>
            <span className="text-sm text-mist tabular-nums">{shown.length}</span>
            <span className="flex-1" />
            <InputGroup className="w-52">
              <InputGroupAddon><Search aria-hidden /></InputGroupAddon>
              <InputGroupInput
                ref={filterRef}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
                placeholder="Search canvases"
                aria-label="Search canvases"
              />
            </InputGroup>
            <ChoiceSelect label="Sort by" value={sort} onChange={setSort} options={[
              { value: 'edited', label: 'Last edited' },
              { value: 'created', label: 'Recently made' },
              { value: 'name', label: 'Name' },
            ]} />
            <ToggleGroup aria-label="Canvas layout" size="sm" variant="outline" spacing={0}
              value={[layout]} onValueChange={([value]) => { if (value === 'grid' || value === 'list') setLayout(value) }}>
              <ToggleGroupItem value="grid" aria-label="Grid"><LayoutGrid aria-hidden /></ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="List"><List aria-hidden /></ToggleGroupItem>
            </ToggleGroup>
          </div>

          {offline && <p className="py-8 text-center text-sm text-slate">Can’t reach the Zeko server. Start it and this page fills in.</p>}
          {canvases && shown.length === 0 && (q || view === 'waiting') && (
            <p className="py-8 text-center text-sm text-slate">{q ? `No canvas matches “${filter.trim()}”.` : 'No canvas has a request waiting.'}</p>
          )}

          {layout === 'grid' ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
              {canvases === null && !offline && [0, 1, 2].map((i) => <li key={i}><Skeleton className="h-[214px] rounded-xl motion-reduce:animate-none" /></li>)}
              {shown.map((c) => (
                <li key={c.id}>
                  <Card c={c} now={now} renaming={renaming === c.id} onRename={(n) => void rename(c, n)} onMenu={(x, y) => cardMenu(c, x, y)} />
                </li>
              ))}
              {canvases && !q && view === 'all' && (
                <li>
                  <button
                    onClick={() => void create({})}
                    className="flex h-[214px] w-full flex-col items-center justify-center gap-2 rounded-xl text-sm text-slate shadow-[inset_0_0_0_1px_var(--color-hair)] [background-image:radial-gradient(var(--color-hair)_1px,transparent_1px)] [background-size:16px_16px] hover:text-ink hover:shadow-[inset_0_0_0_1px_var(--color-mist)]"
                  >
                    <span className="grid size-8 place-items-center rounded-full bg-wash">
                      <Plus size={15} />
                    </span>
                    New canvas
                  </button>
                </li>
              )}
            </ul>
          ) : (
            <div className="overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_var(--color-hair)]">
              <div className="grid grid-cols-[1fr_90px_120px_120px_40px] items-center border-b border-hair-soft px-4 py-2 text-2xs text-mist">
                <span>Name</span>
                <span>Frames</span>
                <span>Requests</span>
                <span>Edited</span>
                <span />
              </div>
              {shown.map((c) => (
                <div key={c.id} className="group grid grid-cols-[1fr_90px_120px_120px_40px] items-center border-b border-hair-soft px-4 last:border-0 hover:bg-white/[0.02]">
                  {renaming === c.id ? (
                    <RenameInput initial={c.name} onDone={(n) => void rename(c, n)} />
                  ) : (
                    <Link href={`/c/${c.id}`} className="truncate py-3 font-medium hover:underline">
                      {c.name}
                    </Link>
                  )}
                  <span className="text-sm text-slate tabular-nums">{c.frames}</span>
                  <span className="text-sm text-slate">{c.openTasks ? `${c.openTasks} waiting` : '–'}</span>
                  <span className="text-sm text-slate">{now ? ago(c.updatedAt, now) : ''}</span>
                  <button
                    aria-label={`More for ${c.name}`}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect()
                      cardMenu(c, r.right - 200, r.bottom + 4)
                    }}
                    className="grid size-7 place-items-center rounded-md text-mist opacity-0 group-hover:opacity-100 hover:bg-wash hover:text-ink focus:opacity-100"
                  >
                    <MoreHorizontal size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {connectOpen && <ConnectDialog agents={agents} now={now} open={connectOpen} onOpenChange={setConnectOpen} />}
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  )
}

function SideItem({ icon, active, count, onClick, children }: { icon: React.ReactNode; active?: boolean; count?: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cx('flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-sm', active ? 'bg-wash text-ink' : 'text-slate hover:bg-wash hover:text-ink')}
    >
      <span className={active ? 'text-ink' : 'text-mist'}>{icon}</span>
      <span className="flex-1 text-left">{children}</span>
      {count !== undefined && <span className="text-2xs text-mist tabular-nums">{count}</span>}
    </button>
  )
}

/* ---------- The prompt that starts a canvas ---------- */

function Hero({ onCreate }: { onCreate: (body: Record<string, unknown>) => Promise<void> }) {
  const [text, setText] = useState('')
  const [variants, setVariants] = useState(1)
  const [agent, setAgent] = useState<AcpAgentId>('codex')
  const [sending, setSending] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const agents = useAcpAgents()
  const recipient = acpAgent(agent)!
  const available = agents.some(({ id, available }) => id === agent && available)

  const send = async () => {
    const body = text.trim()
    if (!body || !available || sending) return
    setSending(true)
    const prompt = variants > 1 ? `${body}\n\nMake ${variants} variants to compare, stacked in one deck.` : body
    await onCreate({ prompt, acp: { agent, settings: {} } })
    setSending(false)
  }

  return (
    <section className="relative px-8 pt-24 pb-14">
      {/* The light table: a lit surface the sketches sit on. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px] overflow-hidden">
        <div className="absolute top-[150px] left-1/2 h-[300px] w-[1100px] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgb(241_241_243/0.14),transparent)]" />
        <div className="absolute top-[250px] left-1/2 h-[160px] w-[760px] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgb(255_61_97/0.30),transparent)] blur-2xl" />
        <div className="absolute inset-0 [background-image:radial-gradient(rgb(255_255_255/0.07)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(60%_55%_at_50%_55%,black,transparent)]" />
      </div>

      <div className="relative mx-auto flex max-w-[760px] flex-col items-center">
        <Mark size={44} />
        <h1 className="mt-6 text-center text-[44px] leading-[1.1] font-light tracking-[-0.02em]">What should we design?</h1>
        <p className="mt-3 text-center text-[15px] text-slate">Start a canvas with a request for your coding agent.</p>

        <div className="mt-7 flex flex-wrap justify-center gap-1.5">
          {IDEA_LABELS.map((label, i) => (
            <button
              key={label}
              onClick={() => {
                setText(IDEAS[i]!)
                box.current?.focus()
              }}
              className="h-8 rounded-full bg-white/[0.04] px-3.5 text-sm text-slate shadow-[inset_0_0_0_1px_var(--color-hair)] backdrop-blur hover:bg-wash hover:text-ink"
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => void onCreate({ sample: 'open' })}
            className="h-8 rounded-full bg-white/[0.04] px-3.5 text-sm text-slate shadow-[inset_0_0_0_1px_var(--color-hair)] backdrop-blur hover:bg-wash hover:text-ink"
          >
            Open sample canvas
          </button>
        </div>

        <div className="mt-5 w-full rounded-2xl bg-panel/95 p-2 shadow-[0_0_0_1px_var(--color-hair),0_24px_60px_-20px_rgb(0_0_0/0.8)] backdrop-blur focus-within:shadow-[0_0_0_1px_var(--color-mist),0_24px_60px_-20px_rgb(0_0_0/0.8)]">
          <InputGroup>
          <InputGroupTextarea
            ref={box}
            autoFocus
            value={text}
            rows={3}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
            aria-label="What to design"
            placeholder="Describe a screen, a flow or a whole site…"
            className="field-sizing-content max-h-64 min-h-20 w-full resize-none bg-transparent px-2.5 py-2 text-[15px] leading-relaxed outline-none placeholder:text-mist focus-visible:outline-none"
          />
          <InputGroupAddon align="block-end">
            <span className="flex-1" />
            <ChoiceSelect label="Design variants" size="sm" value={String(variants)}
              options={[1, 2, 3, 4].map((count) => ({ value: String(count), label: count === 1 ? 'One design' : `${count} variants` }))}
              onChange={(value) => setVariants(Number(value))} />
            <AcpAgentPicker agents={agents} selected={agent} onSelect={setAgent} />
            <Button size="icon" aria-label="Start designing" onClick={() => void send()}
              disabled={!text.trim() || !available || sending} className="rounded-full">
              <ArrowUp aria-hidden />
            </Button>
          </InputGroupAddon>
          </InputGroup>
        </div>

        <p className="mx-4 w-[calc(100%-32px)] rounded-b-xl bg-white/[0.03] px-4 py-2.5 text-sm text-slate shadow-[inset_0_0_0_1px_var(--color-hair-soft)]">
          {recipient.name} starts when you send the request.
        </p>
      </div>
    </section>
  )
}

/* ---------- Cards ---------- */

function Card({ c, now, renaming, onRename, onMenu }: { c: Canvas; now: number; renaming: boolean; onRename: (name: string) => void; onMenu: (x: number, y: number) => void }) {
  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      className="group relative overflow-hidden rounded-xl bg-white/[0.02] shadow-[inset_0_0_0_1px_var(--color-hair)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--color-mist)]"
    >
      <Link href={`/c/${c.id}`} aria-label={`Open ${c.name}`} className="block">
        <Cover cover={c.cover} />
      </Link>
      <div className="flex items-center gap-2 border-t border-hair-soft px-3.5 py-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <RenameInput initial={c.name} onDone={onRename} />
          ) : (
            <Link href={`/c/${c.id}`} className="block truncate font-medium">
              {c.name}
            </Link>
          )}
          <p className="mt-0.5 truncate text-xs text-mist">
            Edited {now ? ago(c.updatedAt, now) : ''}
            {c.openTasks > 0 && <span className="text-[#f5a524]"> · {c.openTasks} waiting</span>}
          </p>
        </div>
        {c.agents.slice(0, 3).map((a) => (
          <Tip key={a} label={`${a} is here`}>
            <span className="shrink-0">
              <AgentAvatar name={a} />
            </span>
          </Tip>
        ))}
        <button
          aria-label={`More for ${c.name}`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            onMenu(r.right - 200, r.bottom + 4)
          }}
          className="grid size-7 shrink-0 place-items-center rounded-md text-mist opacity-0 group-hover:opacity-100 hover:bg-wash hover:text-ink focus:opacity-100"
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
    </div>
  )
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string) => void }) {
  return (
    <Input
      autoFocus
      defaultValue={initial}
      aria-label="Canvas name"
      onFocus={(e) => e.target.select()}
      onBlur={(e) => onDone(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') onDone(initial)
      }}
      className="h-7 w-full rounded-md bg-white/[0.04] px-2 font-medium shadow-[inset_0_0_0_1px_var(--color-grease)] outline-none"
    />
  )
}

/** The canvas's first screen, scaled down to fit the card. Scripts don't run here. */
function Cover({ cover }: { cover: Canvas['cover'] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  if (!cover) {
    return (
      <div className="grid h-[150px] place-items-center text-sm text-mist [background-image:radial-gradient(var(--color-hair)_1px,transparent_1px)] [background-size:16px_16px]">
        Empty canvas
      </div>
    )
  }
  const scale = width ? width / cover.w : 0
  return (
    <div ref={ref} className="relative h-[150px] overflow-hidden bg-white">
      {scale > 0 && (
        <iframe
          title=""
          tabIndex={-1}
          sandbox=""
          srcDoc={cover.html}
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
          style={{ width: cover.w, height: cover.h, transform: `scale(${scale})` }}
        />
      )}
    </div>
  )
}
