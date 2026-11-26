'use client'

import { useState } from 'react'
import { Bot, Check, Trash2 } from 'lucide-react'
import { ago, newId } from '@/lib/client/useBoard'
import type { Actor, Comment, Frame } from '@/lib/types'
import { AgentAvatar } from './AgentAvatar'
import { cx } from './kit'
import { useCameraZoom, useStudio } from './studio-context'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Field, FieldLabel } from './ui/field'
import { Textarea } from './ui/textarea'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './ui/input-group'

function Face({ actor, size = 20 }: { actor: Actor; size?: number }) {
  if (actor.kind === 'agent') return <AgentAvatar name={actor.name} size={size} />

  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-ink text-[10px] font-semibold text-on-ink"
      style={{ width: size, height: size }}
    >
      {actor.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** Pins, the new-comment box and an open thread, drawn at screen size over a frame. */
export function FrameComments({ frame }: { frame: Frame }) {
  const { board, draft, openThread, threadInPanel, setOpenThread } = useStudio()
  const k = 1 / useCameraZoom()
  const comments = board.comments.filter((c) => c.frameId === frame.id && (!c.resolved || c.id === openThread))

  return (
    <>
      {comments.map((c, i) => (
        <Anchor key={c.id} x={c.x} y={c.y} k={k}>
          <Button variant="ghost" size="icon-sm"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setOpenThread(openThread === c.id && !threadInPanel ? null : c.id)}
            aria-label={`Comment ${i + 1}: ${c.text}`}
            className={`relative -translate-y-full grid size-7 place-items-center rounded-full rounded-bl-none text-xs font-semibold text-white shadow-pop ring-2 ring-white/90 ${
              c.resolved ? 'bg-mist' : 'bg-grease'
            }`}
          >
            {c.forAgents ? <Bot size={14} /> : i + 1}
          </Button>
          {openThread === c.id && !threadInPanel && <CommentThread key={c.id} comment={c} />}
        </Anchor>
      ))}
      {draft?.frameId === frame.id && (
        <Anchor x={draft.x} y={draft.y} k={k}>
          <span className="block size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-grease shadow-pop" />
          <Composer frameId={frame.id} x={draft.x} y={draft.y} />
        </Anchor>
      )}
    </>
  )
}

function Anchor({ x, y, k, children }: { x: number; y: number; k: number; children: React.ReactNode }) {
  return (
    <div className="absolute z-10 origin-top-left" style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: `scale(${k})` }}>
      {children}
    </div>
  )
}

function Composer({ frameId, x, y }: { frameId: string; x: number; y: number }) {
  const { dispatch, setDraft, setOpenThread, setTool } = useStudio()
  const [text, setText] = useState('')
  const [forAgents, setForAgents] = useState(false)
  const post = () => {
    const body = text.trim()
    if (!body) return
    const id = newId()
    dispatch({ type: 'comment.add', comment: { id, frameId, x, y, text: body, forAgents } })
    setDraft(null)
    setOpenThread(id)
    setTool('select')
  }
  return (
    <div className="menu-in absolute top-3 left-3 w-72 rounded-xl bg-[#202125] p-2 shadow-pop" onPointerDown={(e) => e.stopPropagation()}>
      <Textarea aria-label="New comment"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            post()
          }
          if (e.key === 'Escape') setDraft(null)
        }}
        rows={3}
        placeholder="What should change here?"
        className="resize-none"
      />
      <div className="mt-1.5 flex items-center justify-between">
        <Field orientation="horizontal" className="w-auto gap-1.5">
          <Checkbox id="comment-for-agents" checked={forAgents} onCheckedChange={setForAgents} />
          <FieldLabel htmlFor="comment-for-agents" className="text-xs">Ask agents to act on it</FieldLabel>
        </Field>
        <Button size="sm" onClick={post} disabled={!text.trim()}>Post</Button>
      </div>
    </div>
  )
}

export function CommentThread({ comment, docked = false }: { comment: Comment; docked?: boolean }) {
  const { dispatch, now, setOpenThread } = useStudio()
  const [reply, setReply] = useState('')
  const send = () => {
    const text = reply.trim()
    if (!text) return
    dispatch({ type: 'comment.reply', id: comment.id, replyId: newId(), text })
    setReply('')
  }
  const all = [{ id: comment.id, author: comment.author, text: comment.text, at: comment.at }, ...comment.replies]
  return (
    <div className={cx('min-w-0', docked ? 'inspector-card' : 'menu-in absolute top-1 left-9 w-80 rounded-xl bg-[#202125] shadow-pop')} onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-hair-soft px-3 py-2">
        <span className="text-xs text-slate">{comment.resolved ? 'Resolved' : comment.forAgents ? 'For agents' : 'Open thread'}</span>
        <span className="flex gap-0.5">
          <Button variant="ghost" size="icon-sm"
            title={comment.resolved ? 'Reopen' : 'Resolve'}
            aria-label={comment.resolved ? 'Reopen comment' : 'Resolve comment'}
            onClick={() => dispatch({ type: 'comment.resolve', id: comment.id, resolved: !comment.resolved })}
            className={`grid size-6 place-items-center rounded-md hover:bg-wash ${comment.resolved ? 'text-live' : 'text-slate'}`}
          >
            <Check size={14} />
          </Button>
          <Button variant="ghost" size="icon-sm"
            title="Delete"
            aria-label="Delete comment"
            onClick={() => {
              dispatch({ type: 'comment.delete', id: comment.id })
              setOpenThread(null)
            }}
            className="grid size-6 place-items-center rounded-md text-slate hover:bg-wash hover:text-grease"
          >
            <Trash2 size={13} />
          </Button>
        </span>
      </div>
      <ul className="flex max-h-72 flex-col gap-3 overflow-auto px-3 py-3">
        {all.map((m) => (
          <li key={m.id} className="flex gap-2">
            <Face actor={m.author} />
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-semibold">{m.author.name}</span>
                <span className="text-2xs text-mist">{ago(m.at, now)}</span>
              </div>
              <p className="text-sm wrap-anywhere whitespace-pre-wrap text-ink/90">{m.text}</p>
            </div>
          </li>
        ))}
      </ul>
      <form className="border-t p-2" onSubmit={(event) => { event.preventDefault(); send() }}>
        <InputGroup>
          <InputGroupInput value={reply} aria-label="Reply" placeholder="Reply…"
            onChange={(event) => setReply(event.currentTarget.value)} />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit" variant="default" disabled={!reply.trim()}>Reply</InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  )
}

export { Face }
