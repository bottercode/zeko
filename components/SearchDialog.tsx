'use client'

import { useMemo, useState } from 'react'
import { ArrowRight, CornerDownLeft, MessageSquare, PenLine, Radio, Sparkles } from 'lucide-react'
import { visibleFrames } from '@/lib/ops'
import { useStudio } from './studio-context'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from './ui/command'

interface Hit {
  id: string
  group: 'Screens' | 'Comments' | 'Requests' | 'Actions'
  label: string
  detail?: string
  icon: React.ReactNode
  run: () => void
}

/** ⌘K: jump to any screen, comment or request, or run a board action. */
export function SearchDialog({ onClose }: { onClose: () => void }) {
  const s = useStudio()
  const { board } = s
  const [query, setQuery] = useState('')

  const hits = useMemo<Hit[]>(() => {
    const go = (frameId: string, thread?: string) => {
      const f = board.frames.find((x) => x.id === frameId)
      if (!f) return
      s.setTool('select')
      s.showResult([f])
      if (thread) s.setOpenThread(thread)
    }
    const all: Hit[] = [
      ...visibleFrames(board).map((f) => ({
        id: `f:${f.id}`,
        group: 'Screens' as const,
        label: f.name,
        detail: [f.route, f.state && f.state !== 'default' ? f.state : undefined].filter(Boolean).join(' · '),
        icon: f.kind === 'live' ? <Radio size={14} /> : <PenLine size={14} />,
        run: () => go(f.id),
      })),
      ...board.comments
        .filter((c) => !c.resolved)
        .map((c) => ({
          id: `c:${c.id}`,
          group: 'Comments' as const,
          label: c.text,
          detail: `${c.author.name} on ${board.frames.find((f) => f.id === c.frameId)?.name ?? 'a frame'}`,
          icon: <MessageSquare size={14} />,
          run: () => go(c.frameId, c.id),
        })),
      ...board.tasks.map((t) => ({
        id: `t:${t.id}`,
        group: 'Requests' as const,
        label: t.text,
        detail: t.status === 'done' ? `done by ${t.claimedBy}` : t.status === 'claimed' ? `${t.claimedBy} is on it` : 'waiting',
        icon: <Sparkles size={14} />,
        run: () => t.frameIds[0] && go(t.frameIds[0]),
      })),
      { id: 'a:sketch', group: 'Actions', label: 'Add a sketch', icon: <PenLine size={14} />, run: () => s.addFrame('sketch') },
      { id: 'a:fit', group: 'Actions', label: 'Fit everything', icon: <ArrowRight size={14} />, run: s.fit },
      {
        id: 'a:arrange',
        group: 'Actions',
        label: 'Arrange as sheet',
        icon: <ArrowRight size={14} />,
        run: () => s.dispatch({ type: 'sheet.arrange', pageId: s.pageId }),
      },
      { id: 'a:connect', group: 'Actions', label: 'MCP connection', icon: <ArrowRight size={14} />, run: s.openConnect },
      { id: 'a:keys', group: 'Actions', label: 'Keyboard shortcuts', icon: <ArrowRight size={14} />, run: s.openShortcuts },
    ]
    const q = query.trim().toLowerCase()
    if (!q) return all.filter((h) => h.group === 'Screens' || h.group === 'Actions')
    return all.filter((h) => `${h.label} ${h.detail ?? ''}`.toLowerCase().includes(q))
  }, [board, query, s])

  return (
    <CommandDialog open onOpenChange={(open) => { if (!open) onClose() }} title="Search the board"
      description="Search screens, comments, requests and actions." className="sm:max-w-xl">
      <Command shouldFilter={false} label="Search the board">
        <CommandInput value={query} onValueChange={setQuery} placeholder="Search screens, comments, requests and actions…" />
        <CommandList className="max-h-[50vh]">
          <CommandEmpty>Nothing matches “{query.trim()}”.</CommandEmpty>
          {(['Screens', 'Comments', 'Requests', 'Actions'] as const).map((group) => {
            const matches = hits.filter((hit) => hit.group === group)
            if (!matches.length) return null
            return (
              <CommandGroup heading={group} key={group}>
                {matches.map((hit) => (
                  <CommandItem key={hit.id} value={hit.id} onSelect={() => { onClose(); hit.run() }}>
                    {hit.icon}
                    <span className="min-w-0 flex-1 truncate">{hit.label}</span>
                    {hit.detail && <span className="max-w-[45%] truncate text-xs text-muted-foreground">{hit.detail}</span>}
                    <CommandShortcut><CornerDownLeft aria-hidden /></CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )
          })}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
