'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Frame as FrameIcon, Globe, Plus, Trash2 } from 'lucide-react'
import { ago, newId } from '@/lib/client/useBoard'
import { parseWebsiteUrl, RULE_TEXT_LIMIT } from '@/lib/ops'
import { withDesignTokens } from '@/lib/tokens'
import type { Frame, MemoryRule } from '@/lib/types'
import { IconButton } from './kit'
import { SkillsPanel } from './SkillsPanel'
import { Button } from './ui/button'
import { useStudio } from './studio-context'
import { Field, FieldGroup, FieldLabel } from './ui/field'
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
        <MemoryContext references={references} rules={rules} editor={editor} onEdit={setEditor} onRemove={remove} onSave={save} />
      </TabsContent>
      <TabsContent value="skills"><SkillsPanel /></TabsContent>
    </Tabs>
  )
}

function MemoryContext({ references, rules, editor, onEdit, onRemove, onSave }: {
  references: Frame[]
  rules: RuleDraft[]
  editor: RuleDraft | null
  onEdit: (rule: RuleDraft | null) => void
  onRemove: (rule: RuleDraft) => void
  onSave: (rule: RuleDraft) => void
}) {
  const { now, showResult } = useStudio()
  return (
    <>
      <section className="px-3 py-3.5" aria-labelledby="memory-references">
        <h2 id="memory-references" className="mb-2.5 text-xs font-semibold text-slate">References</h2>
        {references.length ? (
          <ul className="flex flex-col gap-1">
            {references.map((frame) => (
              <li key={frame.id} className="min-w-0">
                <Button variant="ghost" type="button" onClick={() => showResult([frame])} aria-label={`Open reference ${frame.name}`} className="h-auto w-full min-w-0 justify-start gap-2 px-1.5 py-1.5 text-left">
                  {frame.kind === 'website' ? (
                    <span className="grid h-9 w-12 shrink-0 place-items-center rounded-md border border-border bg-muted"><Globe aria-hidden className="text-muted-foreground" /></span>
                  ) : <ReferencePreview frame={frame} />}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate">{frame.name}</span>
                    <span className="truncate text-xs font-normal text-muted-foreground">{frame.kind === 'website' ? parseWebsiteUrl(frame.url)?.hostname : now > 0 ? `Edited ${ago(frame.updatedAt, now)}` : 'Sketch'}</span>
                  </span>
                  <ArrowUpRight aria-hidden className="text-muted-foreground" />
                </Button>
              </li>
            ))}
          </ul>
        ) : <p className="text-slate">Pin a frame from Design → Handoff.</p>}
      </section>
      <section className="editor-divider border-t px-3 py-3.5" aria-labelledby="memory-rules">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="memory-rules" className="text-xs font-semibold text-slate">Rules</h2>
          {!editor && <Button size="sm" variant="secondary" onClick={() => onEdit({ title: '', text: '' })}><Plus aria-hidden data-icon="inline-start" /> Add rule</Button>}
        </div>
        {editor ? <RuleEditor rule={editor} onSave={onSave} onClose={() => onEdit(null)} /> : rules.length ? (
          <ul className="divide-y divide-hair">
            {rules.map((rule) => (
              <li key={rule.legacy ? 'guidelines' : `rule:${rule.id}`} className="flex min-w-0 items-center gap-1 py-0.5">
                <Button variant="ghost" type="button" onClick={() => onEdit(rule)} className="h-auto min-w-0 flex-1 flex-col items-start gap-0 px-2 py-1.5 text-left [&>span]:max-w-full" aria-label={`Edit ${rule.title}`}>
                  <span className="block truncate font-medium">{rule.title}</span>
                  <span className="block truncate text-xs text-slate">{rule.text}</span>
                </Button>
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
    <span ref={ref} aria-hidden className="relative grid h-9 w-12 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted">
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
    <form aria-label={rule.legacy || rule.id ? 'Edit rule' : 'New rule'} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3" onSubmit={(event) => {
      event.preventDefault()
      if (name && body) onSave({ ...rule, title: name, text: body })
    }} onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        event.currentTarget.requestSubmit()
      }
    }}>
      <FieldGroup className="gap-3">
        {rule.legacy ? <p className="text-sm font-medium">Canvas guidelines</p> : <Field className="gap-1.5">
          <FieldLabel htmlFor="memory-rule-name">Rule name</FieldLabel>
          <Input id="memory-rule-name" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="e.g. Brand voice" required />
        </Field>}
        <Field className="gap-1.5">
          <FieldLabel htmlFor="memory-rule-text">Instructions</FieldLabel>
          <Textarea id="memory-rule-text" value={text} onChange={(event) => setText(event.target.value)} maxLength={RULE_TEXT_LIMIT} placeholder="What should agents follow?" className="min-h-24 max-h-60 resize-y text-sm" required />
        </Field>
      </FieldGroup>
      {text.length === RULE_TEXT_LIMIT && <p role="status" className="text-xs text-muted-foreground">Character limit reached.</p>}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" size="sm" disabled={!name || !body}>Save rule</Button>
      </div>
    </form>
  )
}
