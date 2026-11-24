'use client'

import { Fragment, useRef, useState } from 'react'
import { ArrowUpRight, Brain, ChevronDown, CircleAlert, CodeXml, Frame as FrameIcon, History, MessageSquarePlus, Play, Sparkles, Wrench } from 'lucide-react'
import { code } from '@streamdown/code'
import { defaultRehypePlugins, Streamdown } from 'streamdown'
import { ago, newId } from '@/lib/client/useBoard'
import { DEFAULT_CHAT_ID, localAgentProvider, taskResultFrames } from '@/lib/ops'
import type { Task } from '@/lib/types'
import { AgentAvatar } from './AgentAvatar'
import { Composer } from './BriefBar'
import { Button, IconButton } from './kit'
import { useStudio } from './studio-context'
import { Attachment, AttachmentContent, AttachmentTitle, AttachmentTrigger } from './ui/attachment'
import { Bubble, BubbleContent } from './ui/bubble'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Message, MessageContent, MessageHeader } from './ui/message'
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem,
  MessageScrollerProvider, MessageScrollerViewport,
} from './ui/message-scroller'
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle } from './ui/trace'

const markdownPlugins = { code }
const safeMarkdown = [defaultRehypePlugins.sanitize]
const markdownControls = { code: { copy: true, download: false }, table: false }
const chatLink = (url: string) => {
  if (!/^https?:\/\//i.test(url)) return undefined
  try { return new URL(url).href } catch { return undefined }
}

export function AgentChat() {
  const { board, now } = useStudio()
  const [selected, setSelected] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement | null>(null)
  const turns = [...board.tasks].reverse().sort((a, b) => a.at - b.at)
  const threads = new Map<string, { title: string; turns: Task[]; lastMessage: number }>()
  for (const task of turns) {
    const id = task.chatId ?? DEFAULT_CHAT_ID
    const thread = threads.get(id)
    if (thread) {
      thread.turns.push(task)
      thread.lastMessage = task.at
    } else {
      threads.set(id, { title: task.text.trim().replace(/\s+/g, ' ').slice(0, 56) || 'Chat', turns: [task], lastMessage: task.at })
    }
  }
  const history = [...threads.entries()].sort((a, b) => b[1].lastMessage - a[1].lastMessage)
  const chatId = selected ?? history[0]?.[0] ?? DEFAULT_CHAT_ID
  const current = threads.get(chatId)
  const active = current?.turns.findLast((task) => task.localRun && !task.localRun.error)
  const previous = current?.turns.at(-1)
  const legacyAgent = localAgentProvider(previous?.assignee)

  return (
    <>
      <div className="editor-divider flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <DropdownMenu>
          <DropdownMenuTrigger type="button" aria-label="Chat history" className="editor-control flex h-7 min-w-0 flex-1 items-center gap-1.5 px-1.5 text-left text-xs">
            <History size={14} className="shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{current?.title ?? 'New chat'}</span>
            <ChevronDown size={13} className="shrink-0" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            {history.length ? (
              <DropdownMenuRadioGroup aria-label="Chats" value={chatId} onValueChange={setSelected}>
                {history.map(([id, thread]) => (
                  <DropdownMenuRadioItem key={id} value={id} closeOnClick>
                    <span className="min-w-0 flex-1 truncate" title={thread.title}>{thread.title}</span>
                    {now > 0 && <span className="shrink-0 text-2xs text-slate">{ago(thread.lastMessage, now)}</span>}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            ) : <DropdownMenuGroup><DropdownMenuLabel>No previous chats</DropdownMenuLabel></DropdownMenuGroup>}
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton label="New chat" className="size-7 shrink-0" onClick={() => {
          setSelected(newId())
          input.current?.focus()
        }}><MessageSquarePlus size={15} /></IconButton>
      </div>
      {current ? <Transcript key={chatId} turns={current.turns} /> : (
        <div className="grid min-h-0 flex-1 place-items-center px-5 text-center">
          <div className="flex flex-col items-center gap-2">
            <Sparkles size={19} className="text-slate" aria-hidden />
            <p className="text-sm text-slate">Ask an agent to design something or pick an element to change.</p>
          </div>
        </div>
      )}
      <Composer chatId={chatId} inputRef={input} activeTask={active?.id} previous={previous?.acp ?? (legacyAgent ? { agent: legacyAgent, settings: {} } : undefined)} />
    </>
  )
}

function Transcript({ turns }: { turns: Task[] }) {
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent role="log" aria-label="Agent conversation" className="gap-4 px-3 py-4">
            {turns.map((task) => (
              <Fragment key={task.id}>
                <MessageScrollerItem messageId={`${task.id}:user`}>
                  <UserMessage task={task} />
                </MessageScrollerItem>
                <MessageScrollerItem messageId={`${task.id}:agent`}>
                  <AgentMessage task={task} />
                </MessageScrollerItem>
              </Fragment>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

function UserMessage({ task }: { task: Task }) {
  const { board, showResult } = useStudio()
  const frames = board.frames.filter((frame) => task.frameIds.includes(frame.id))
  const element = frames.some((frame) => frame.id === task.element?.frameId) ? task.element : undefined
  const label = element ? element.text || element.name : frames.map((frame) => frame.name).join(', ')

  return (
    <Message align="end" aria-label="Your message">
      <MessageContent className="gap-1.5">
        <Bubble align="end" variant="secondary" className="max-w-[88%]">
          <BubbleContent className="wrap-anywhere whitespace-pre-wrap">{task.text}</BubbleContent>
        </Bubble>
        {frames.length > 0 && (
          <Attachment size="xs" className="w-fit min-w-0 max-w-[88%] gap-1.5 px-2 py-0.5">
            {element ? <CodeXml className="size-3 shrink-0 text-slate" aria-hidden /> : <FrameIcon className="size-3 shrink-0 text-slate" aria-hidden />}
            {element && <code className="shrink-0 text-2xs text-slate">&lt;{element.tag}&gt;</code>}
            <AttachmentContent className="p-0">
              <AttachmentTitle title={label}>{label}{element && frames.length > 1 ? ` +${frames.length - 1}` : ''}</AttachmentTitle>
            </AttachmentContent>
            <AttachmentTrigger aria-label={`Open attachment ${label}`} onClick={() => showResult(frames)} className="rounded-lg focus-visible:ring-1 focus-visible:ring-grease" />
          </Attachment>
        )}
      </MessageContent>
    </Message>
  )
}

function AgentMessage({ task }: { task: Task }) {
  const { boardId, board, showResult, toast } = useStudio()
  const name = task.claimedBy ?? task.assignee ?? 'Agent'
  const done = task.status === 'done'
  const working = task.status === 'claimed'
  const error = task.localRun?.error
  const starting = task.status === 'open' && !!task.localRun && !error
  const canStart = task.status === 'open' && !starting && !!(task.acp || localAgentProvider(task.assignee))
  const streaming = !!task.localRun && !error
  const reply = task.reply || task.localRun?.message || (done ? task.summary || 'Done.' : '')
  const results = done ? taskResultFrames(board, task) : []

  const start = async () => {
    try {
      const response = await fetch(`/api/board?board=${encodeURIComponent(boardId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'task.start', id: task.id }),
      })
      if (response.ok) return
      const result = await response.json() as { error?: string }
      toast(result.error ?? `Couldn’t start ${name}.`)
    } catch {
      toast('Couldn’t reach Zeko.')
    }
  }

  return (
    <Message align="start" aria-label={`${name} reply`}>
      <MessageContent className="gap-2">
        <MessageHeader className="gap-2 px-0">
          <AgentAvatar name={name} size={21} />
          <span className="min-w-0 flex-1 truncate font-semibold text-ink">{name}</span>
        </MessageHeader>
        {(task.thinking || task.tools?.length) && (
          <Trace>
            {task.thinking && (
              <TraceCollapsible>
                <TraceCollapsibleTrigger aria-label="Thinking">
                  <TraceLine status={streaming && !reply ? 'running' : undefined} className="text-xs">
                    <TraceIcon><Brain /></TraceIcon><TraceTitle>{streaming && !reply ? 'Thinking…' : 'Thinking'}</TraceTitle>
                  </TraceLine>
                </TraceCollapsibleTrigger>
                <TraceCollapsibleContent className="whitespace-pre-wrap text-xs">{task.thinking}</TraceCollapsibleContent>
              </TraceCollapsible>
            )}
            {!!task.tools?.length && (
              <TraceCollapsible>
                <TraceCollapsibleTrigger aria-label="Tool activity">
                  <TraceLine status={streaming ? 'running' : undefined} className="text-xs">
                    <TraceIcon><Wrench /></TraceIcon>
                    <TraceTitle>{task.tools.length} {task.tools.length === 1 ? 'tool call' : 'tool calls'}</TraceTitle>
                  </TraceLine>
                </TraceCollapsibleTrigger>
                <TraceCollapsibleContent>
                  {task.tools.map((tool) => (
                    <TraceLine key={tool.id} status={tool.status === 'failed' ? 'error' : tool.status === 'completed' ? undefined : streaming ? 'running' : 'pending'} className="text-xs">
                      <TraceIcon><Wrench /></TraceIcon><TraceTitle>{tool.title}</TraceTitle>
                    </TraceLine>
                  ))}
                </TraceCollapsibleContent>
              </TraceCollapsible>
            )}
          </Trace>
        )}
        {reply && (
          <Bubble variant="ghost" className="w-full">
            <BubbleContent className="w-full wrap-anywhere">
              <Streamdown
                className="min-w-0 space-y-2 [&_h1]:text-base [&_h2]:text-base [&_h3]:text-sm [&_p]:whitespace-pre-wrap"
                plugins={markdownPlugins}
                rehypePlugins={safeMarkdown}
                disallowedElements={['img']}
                skipHtml
                urlTransform={chatLink}
                controls={markdownControls}
                lineNumbers={false}
                codeBlockMaxHeight={320}
                mode={streaming ? 'streaming' : 'static'}
                isAnimating={streaming}
              >{reply}</Streamdown>
            </BubbleContent>
          </Bubble>
        )}
        {!done && (!reply || error) && (
          <Trace>
            <TraceLine status={error ? 'error' : starting || working ? 'running' : 'pending'} role="status" className="text-xs">
              <TraceIcon>{error ? <CircleAlert /> : <Sparkles />}</TraceIcon>
              <TraceTitle>{error ? 'Run stopped' : working ? 'Working on your message' : starting ? `Starting ${name}` : canStart ? 'Ready to start' : `Waiting for ${name}`}</TraceTitle>
            </TraceLine>
          </Trace>
        )}
        {error && <p className="text-xs leading-relaxed text-slate">{error}</p>}
        {results.length > 0 && (
          <Button size="sm" className="self-start" onClick={() => showResult(results)}>View result <ArrowUpRight size={13} /></Button>
        )}
        {canStart && <Button size="sm" className="self-start" onClick={() => void start()}><Play size={13} /> {error ? 'Retry' : `Start ${name}`}</Button>}
      </MessageContent>
    </Message>
  )
}
