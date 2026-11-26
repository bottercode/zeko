'use client'

import { useState, type RefObject } from 'react'
import { ArrowUp, CodeXml, Frame as FrameIcon, Paperclip, RefreshCw, Square, X } from 'lucide-react'
import { acpAgent, type AcpSelection } from '@/lib/acp'
import { visibleFrames } from '@/lib/ops'
import { newId } from '@/lib/client/useBoard'
import type { Frame, TaskElement } from '@/lib/types'
import { AcpAgentPicker, AcpOptionPicker, useAcpOptions } from './AcpComposerOptions'
import { AcpConnection } from './AcpConnection'
import { useStudio } from './studio-context'
import { Button, IconButton, Tip } from './kit'
import { InputGroup, InputGroupAddon, InputGroupTextarea } from './ui/input-group'
import { Button as UIButton } from './ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuTrigger } from './ui/dropdown-menu'

/** Requests for agents. They land as tasks that connected agents claim and finish. */
export function Composer({ chatId, inputRef, activeTask, previous }: {
  chatId: string; inputRef: RefObject<HTMLTextAreaElement | null>; activeTask?: string; previous?: AcpSelection
}) {
  const { boardId, board, pageId, dispatch, selection, interactId, element, toast } = useStudio()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const text = drafts[chatId] ?? ''
  const setText = (value: string) => setDrafts((drafts) => ({ ...drafts, [chatId]: value }))
  const [choices, setChoices] = useState<Record<string, AcpSelection>>({})
  const acp = choices[chatId] ?? previous ?? { agent: 'codex', settings: {} }
  const { agents, options, available, error, refreshing, refresh } = useAcpOptions(acp.agent, acp.settings)
  const recipient = acpAgent(acp.agent)!
  const choose = (next: AcpSelection) => setChoices((current) => ({ ...current, [chatId]: next }))
  const [attachments, setAttachments] = useState<{ selectionKey: string; ids: string[] } | null>(null)
  const selectedElement: TaskElement | undefined = element && interactId && selection.includes(interactId) ? {
    frameId: interactId,
    path: element.path,
    tag: element.tag,
    name: element.name.slice(0, 120),
    text: element.text?.trim().replace(/\s+/g, ' ').slice(0, 120) || undefined,
  } : undefined
  const selectionKey = JSON.stringify([chatId, pageId, selection, selectedElement?.frameId, selectedElement?.path])
  if (attachments && attachments.selectionKey !== selectionKey) setAttachments(null)
  const requestedIds = attachments?.selectionKey === selectionKey ? attachments.ids : selection
  const attached = requestedIds.map((id) => board.frames.find((frame) => frame.id === id)).filter((frame): frame is Frame => !!frame)
  const attachedIds = attached.map((frame) => frame.id)
  const attachedElement = selectedElement && attachedIds.includes(selectedElement.frameId) ? selectedElement : undefined
  const pageFrames = visibleFrames(board, pageId)
  const attach = (ids: string[]) => setAttachments({ selectionKey, ids })

  const send = () => {
    const body = text.trim()
    if (!body || !available || activeTask) return
    dispatch({ type: 'task.add', id: newId(), text: body, frameIds: attachedIds, element: attachedElement, pageId, chatId, assignee: recipient.name, acp })
    setText('')
  }

  const stop = async () => {
    try {
      const response = await fetch(`/api/board?board=${encodeURIComponent(boardId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'task.stop', id: activeTask }),
      })
      if (!response.ok) toast('This reply has already stopped.')
    } catch { toast('Couldn’t reach Zeko.') }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); send() }} className="editor-divider shrink-0 border-t p-2.5 transition-colors focus-within:bg-wash/25">
      <AcpConnection />
      {attached.length > 0 && (
        <div role="group" aria-label="Request attachments" className="flex flex-wrap gap-1 px-1 pt-0.5 pb-1.5">
          {attached.slice(0, 3).map((frame) => {
            const target = attachedElement?.frameId === frame.id ? attachedElement : undefined
            const label = target ? target.text || target.name : frame.name
            return (
              <span key={frame.id} title={target ? `<${target.tag}> ${label} in ${frame.name}` : label} className="flex max-w-full items-center gap-1.5 rounded-md bg-grease-soft py-0.5 pr-0.5 pl-1.5 text-xs text-[#ff9aaf]">
                {target ? <CodeXml size={12} className="shrink-0" aria-hidden /> : <FrameIcon size={12} className="shrink-0" aria-hidden />}
                {target && <code className="shrink-0 text-2xs">&lt;{target.tag}&gt;</code>}
                <span className="truncate">{label}</span>
                <UIButton type="button" variant="ghost" size="icon-xs" aria-label={`Detach ${label}`} onClick={() => attach(attachedIds.filter((id) => id !== frame.id))} className="grid size-5 shrink-0 place-items-center rounded hover:bg-white/10">
                  <X size={11} />
                </UIButton>
              </span>
            )
          })}
          {attached.length > 3 && <span className="px-1 text-xs text-slate">and {attached.length - 3} more</span>}
        </div>
      )}
      <InputGroup className="rounded-none border-transparent bg-transparent shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0 dark:bg-transparent">
        <InputGroupTextarea
          ref={inputRef}
          value={text}
          id="agent-request"
          rows={2}
          aria-label="Request for agents"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={`Message ${recipient.name}…`}
          className="block max-h-32 min-h-12 px-1 py-1 text-sm leading-relaxed"
        />
        <InputGroupAddon align="block-end" className="flex-col items-stretch gap-0 px-0 py-0">
          {error && <div role="status" className="px-1 py-1 text-xs text-slate">{error}</div>}
          {options.length > 0 && (
            <div aria-label="Agent options" className="flex flex-wrap gap-1 px-0.5 pb-1">
              {options.map((option) => (
                <AcpOptionPicker key={option.id} option={option} settings={acp.settings} onChange={(id, value) => choose({ ...acp, settings: { ...acp.settings, [id]: value } })} />
              ))}
            </div>
          )}
          <div className="mt-1 flex w-full min-w-0 items-center gap-1.5">
            <DropdownMenu>
              <Tip label="Attach frames" side="top">
                <DropdownMenuTrigger aria-label="Attach frames" disabled={!pageFrames.length}
                  render={<UIButton variant="ghost" size="icon-sm" className="editor-control" />}>
                  <Paperclip aria-hidden />
                </DropdownMenuTrigger>
              </Tip>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuGroup>
                  {pageFrames.map((frame) => (
                    <DropdownMenuCheckboxItem key={frame.id} checked={attachedIds.includes(frame.id)}
                      onCheckedChange={(checked) => attach(checked ? [...attachedIds, frame.id] : attachedIds.filter((id) => id !== frame.id))}>
                      {frame.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="flex-1" />
            <IconButton label="Refresh models" side="top" type="button" aria-busy={refreshing}
              disabled={!available || refreshing} onClick={() => void refresh()} className="size-7">
              <RefreshCw aria-hidden className={refreshing ? 'motion-safe:animate-spin' : undefined} />
            </IconButton>
            <AcpAgentPicker agents={agents} selected={acp.agent} onSelect={(agent) => choose({ agent, settings: {} })} />
            {activeTask ? (
              <Button type="button" size="sm" variant="secondary" aria-label="Stop reply" onClick={() => void stop()} className="size-8 shrink-0 rounded-full p-0"><Square size={13} /></Button>
            ) : <Button
              type="submit"
              size="sm"
              variant="primary"
              aria-label={`Send to ${recipient.name}`}
              disabled={!text.trim() || !available}
              className="size-8 shrink-0 rounded-full p-0"
            >
              <ArrowUp size={15} />
            </Button>}
          </div>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
