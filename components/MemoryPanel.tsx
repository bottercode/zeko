'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Frame as FrameIcon, Globe, Plus, Trash2 } from 'lucide-react'
import { ago, newId } from '@/lib/client/useBoard'
import { parseWebsiteUrl, RULE_TEXT_LIMIT } from '@/lib/ops'
import { withDesignTokens } from '@/lib/tokens'
import type { Frame, MemoryRule } from '@/lib/types'
import { Button, IconButton } from './kit'
import { SkillsPanel } from './SkillsPanel'
import { Button as ActionButton } from './ui/button'
import { useStudio } from './studio-context'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Textarea } from './ui/textarea'

type RuleDraft = Omit<MemoryRule, 'id'> & { id?: string; legacy?: boolean }

export function MemoryPanel() {
  const { board, dispatch, toast, confirm } = useStudio()
  const [editor, setEditor] = useState<RuleDraft | null>(null)
  const references = board.frames.filter((frame) => frame.reference)
  const rules: RuleDraft[] = [...(board.memoryRules ?? [])]
  if (board.guidelines?.trim()) rules.unshift({ legacy: true, title: 'Canvas guidelines', text: board.guidelines })

  const save = (rule: RuleDraft) => {
    if (rule.legacy) dispatch({ type: 'board.update', guidelines: rule.text })
    else dispatch({ type: 'memory.rule.save', rule: { id: rule.id ?? newId(), title: rule.title, text: rule.text } })
    setEditor(null)
    toast('Rule saved')
  }
  const remove = (rule: RuleDraft) => confirm({
    title: `Remove “${rule.title}”?`,
    body: 'Agents will stop receiving this rule with the canvas guidelines.',
    confirm: 'Remove rule',
    onConfirm: () => {
      if (rule.legacy) dispatch({ type: 'board.update', guidelines: '' })
      else if (rule.id) dispatch({ type: 'memory.rule.remove', id: rule.id })
    },
  })

  return (
    <Tabs defaultValue="context" className="editor-content gap-0 text-sm">
      <div className="editor-divider border-b px-3 py-2">
        <TabsList aria-label="Memory views" className="w-full">
          <TabsTrigger value="context">Context</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="context">
        <MemoryContext references={references} rules={rules} onEdit={setEditor} onRemove={remove} />
        {editor && <RuleEditor rule={editor} onSave={save} onClose={() => setEditor(null)} />}
      </TabsContent>
      <TabsContent value="skills"><SkillsPanel /></TabsContent>
    </Tabs>
  )
}

function MemoryContext({ references, rules, onEdit, onRemove }: {
  references: Frame[]
  rules: RuleDraft[]
  onEdit: (rule: RuleDraft) => void
  onRemove: (rule: RuleDraft) => void
}) {
  const { now, showResult } = useStudio()
  return (
    <>
      <section className="px-3 py-3.5" aria-labelledby="memory-references">
        <h2 id="memory-references" className="mb-2.5 text-xs font-semibold text-slate">References</h2>
        {references.length ? (
          <ul className="grid gap-3">
            {references.map((frame) => (
              <li key={frame.id} className="relative min-w-0 rounded-lg hover:bg-wash">
                {frame.kind !== 'website' && <ReferencePreview frame={frame} />}
                <ActionButton variant="ghost" type="button" onClick={() => showResult([frame])} aria-label={`Open reference ${frame.name}`} className="editor-control flex h-auto w-full min-w-0 flex-col items-stretch gap-0.5 px-1.5 pt-1.5 pb-1 text-left before:absolute before:inset-0 before:rounded-lg">
                  <span className="flex min-w-0 items-center justify-between gap-2 font-medium">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {frame.kind === 'website' && <Globe size={13} className="shrink-0 text-slate" aria-hidden />}
                      <span className="truncate">{frame.name}</span>
                    </span>
                    <ArrowUpRight size={13} className="shrink-0 text-slate" aria-hidden />
                  </span>
                  <span className="truncate text-xs text-slate">{frame.kind === 'website' ? parseWebsiteUrl(frame.url)?.href : <>{frame.createdBy.name}{now > 0 && ` · edited ${ago(frame.updatedAt, now)}`}</>}</span>
                </ActionButton>
              </li>
            ))}
          </ul>
        ) : <p className="text-slate">Pin a frame from Design → Handoff.</p>}
      </section>
      <section className="editor-divider border-t px-3 py-3.5" aria-labelledby="memory-rules">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="memory-rules" className="text-xs font-semibold text-slate">Rules</h2>
          <Button size="sm" aria-label="New rule" onClick={() => onEdit({ title: '', text: '' })}><Plus aria-hidden data-icon="inline-start" /> New</Button>
        </div>
        {rules.length ? (
          <ul className="divide-y divide-hair">
            {rules.map((rule) => (
              <li key={rule.legacy ? 'guidelines' : `rule:${rule.id}`} className="flex min-w-0 items-center gap-1 py-0.5">
                <ActionButton variant="ghost" type="button" onClick={() => onEdit(rule)} className="editor-control h-auto min-w-0 flex-1 flex-col items-start gap-0 px-2 py-1.5 text-left [&>span]:max-w-full" aria-label={`Edit ${rule.title}`}>
                  <span className="block truncate font-medium">{rule.title}</span>
                  <span className="block truncate text-xs text-slate">{rule.text}</span>
                </ActionButton>
                <IconButton label={`Remove ${rule.title}`} onClick={() => onRemove(rule)} className="size-7 shrink-0"><Trash2 size={14} /></IconButton>
              </li>
            ))}
          </ul>
        ) : <p className="text-slate">Add a rule for agents to follow on this canvas.</p>}
      </section>
    </>
  )
}

function ReferencePreview({ frame }: { frame: Frame }) {
  const { board } = useStudio()
  const ref = useRef<HTMLSpanElement>(null)
  const [scale, setScale] = useState(0)
  const html = useMemo(() => frame.html ? withDesignTokens(frame.html, board.design) : '', [frame.html, board.design])
  useEffect(() => {
    const el = ref.current
    if (!el || !html) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect
      setScale(Math.min(1, width / Math.max(1, frame.w), height / Math.max(1, frame.h)))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [html, frame.w, frame.h])

  return (
    <span ref={ref} aria-hidden className="relative grid h-28 place-items-center overflow-hidden rounded-lg border border-hair bg-table">
      {html ? scale > 0 && (
        <iframe
          title="Reference preview"
          tabIndex={-1}
          sandbox=""
          srcDoc={html}
          className="pointer-events-none absolute top-1/2 left-1/2 border-0"
          style={{ width: frame.w, height: frame.h, transform: `translate(-50%, -50%) scale(${scale})` }}
        />
      ) : <FrameIcon size={19} className="text-slate" />}
    </span>
  )
}

function RuleEditor({ rule, onSave, onClose }: { rule: RuleDraft; onSave: (rule: RuleDraft) => void; onClose: () => void }) {
  const [title, setTitle] = useState(rule.title)
  const [text, setText] = useState(rule.text)
  const name = title.trim()
  const body = text.trim()

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-auto p-5 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule.legacy || rule.id ? 'Edit rule' : 'New rule'}</DialogTitle>
          <DialogDescription>Agents read this when they work on this canvas.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(event) => {
          event.preventDefault()
          if (name && body) onSave({ ...rule, title: name, text: body })
        }} onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault()
            event.currentTarget.requestSubmit()
          }
        }}>
          <label className="grid gap-1.5 text-xs font-medium">
            Rule name
            <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} readOnly={rule.legacy} placeholder="Palette or voice" required />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Instructions
            <Textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={RULE_TEXT_LIMIT} placeholder="Describe what agents should follow." className="min-h-48 resize-y text-sm" required />
          </label>
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-xs tabular-nums text-slate">{text.length.toLocaleString('en-US')} / {RULE_TEXT_LIMIT.toLocaleString('en-US')}</span>
            <Button type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!name || !body}>Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
