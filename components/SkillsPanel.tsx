'use client'

import { useState } from 'react'
import { BookOpen, Link2, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import { newId } from '@/lib/client/useBoard'
import { SKILL_DESCRIPTION_LIMIT, SKILL_TEXT_LIMIT, SKILL_TITLE_LIMIT, readCanvasSkill, skillSourceUrl } from '@/lib/canvas-skills'
import type { CanvasSkill } from '@/lib/types'
import { IconButton } from './kit'
import { useStudio } from './studio-context'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './ui/field'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

type SkillDraft = Omit<CanvasSkill, 'id'>

export function SkillsPanel() {
  const { board, dispatch, toast, confirm } = useStudio()
  const [editing, setEditing] = useState<CanvasSkill | 'new' | null>(null)
  const skills = board.skills ?? []
  const save = (draft: SkillDraft) => {
    const existing = draft.sourceUrl ? skills.find((skill) => skill.sourceUrl === draft.sourceUrl) : undefined
    const id = editing && editing !== 'new' ? editing.id : existing?.id ?? newId()
    const skill = readCanvasSkill({ id, ...draft })
    if (!skill) return
    dispatch({ type: 'memory.skill.save', skill })
    setEditing(null)
    toast(existing || editing !== 'new' ? 'Skill saved' : 'Skill installed')
  }

  return (
    <section aria-labelledby="memory-skills" className="px-3 py-3.5">
      <div className="mb-2.5 flex min-w-0 items-center justify-between gap-2">
        <h2 id="memory-skills" className="text-xs font-semibold text-muted-foreground">Canvas skills</h2>
        <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
          <Plus data-icon="inline-start" aria-hidden /> Add skill
        </Button>
      </div>
      {skills.length ? (
        <ul className="divide-y divide-hair">
          {skills.map((skill) => (
            <li key={skill.id} className="flex min-w-0 items-center gap-1 py-1">
              <Button variant="ghost" onClick={() => setEditing(skill)} aria-label={`Edit skill ${skill.title}`}
                className="h-auto min-h-10 min-w-0 flex-1 justify-start gap-2 px-2 text-left">
                <BookOpen data-icon="inline-start" aria-hidden className="text-muted-foreground" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{skill.title}</span>
                  {skill.description && <span className="truncate text-xs font-normal text-muted-foreground">{skill.description}</span>}
                </span>
              </Button>
              <IconButton label={`Remove skill ${skill.title}`} className="size-7 shrink-0" onClick={() => confirm({
                title: `Remove “${skill.title}”?`,
                body: 'Agents will stop seeing this skill on this canvas.',
                confirm: 'Remove skill',
                onConfirm: () => dispatch({ type: 'memory.skill.remove', id: skill.id }),
              })}><Trash2 aria-hidden /></IconButton>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm leading-relaxed text-muted-foreground">Add reusable instructions for tasks that come up on this canvas.</p>}
      {editing && <SkillEditor skill={editing === 'new' ? undefined : editing} onSave={save} onClose={() => setEditing(null)} />}
    </section>
  )
}

function SkillEditor({ skill, onSave, onClose }: {
  skill?: CanvasSkill
  onSave: (skill: SkillDraft) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<'write' | 'url'>('write')
  const [draft, setDraft] = useState<SkillDraft>(skill ?? { title: '', description: '', text: '' })
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const hasDraft = mode === 'write' || (!!draft.sourceUrl && skillSourceUrl(url.trim())?.href === draft.sourceUrl)
  const canSave = hasDraft && !!readCanvasSkill({ id: 'draft', ...draft })

  const load = async () => {
    if (!url.trim() || loading) return
    setError('')
    setLoading(true)
    try {
      const response = await fetch('/api/skills/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(10_000),
      })
      const result = await response.json() as SkillDraft & { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Could not load the skill file.')
      setDraft(result)
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== 'TimeoutError' ? cause.message : 'The skill link took too long to respond.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-5 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{skill ? 'Edit skill' : 'Add canvas skill'}</DialogTitle>
          <DialogDescription>Agents use this skill when its description matches their task.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3.5" onSubmit={(event) => {
          event.preventDefault()
          if (canSave && !loading) onSave(draft)
        }}>
          {!skill && (
            <ToggleGroup aria-label="Skill source" variant="outline" spacing={0} className="w-full" value={[mode]} onValueChange={([value]) => {
              if (loading || (value !== 'write' && value !== 'url')) return
              setMode(value)
              setError('')
            }}>
              <ToggleGroupItem type="button" className="flex-1" value="write">Write instructions</ToggleGroupItem>
              <ToggleGroupItem type="button" className="flex-1" value="url">Import from URL</ToggleGroupItem>
            </ToggleGroup>
          )}
          {mode === 'url' && (
            <Field data-invalid={!!error} className="gap-1.5">
              <FieldLabel htmlFor="skill-source-url">File URL</FieldLabel>
              <div className="flex items-center gap-2">
                <Input id="skill-source-url" name="skill-source-url" type="url" value={url} disabled={loading}
                  aria-invalid={!!error} aria-describedby={error ? 'skill-url-error' : 'skill-url-help'}
                  onChange={(event) => { setUrl(event.currentTarget.value); setError('') }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    void load()
                  }}
                  placeholder="https://…/SKILL.md" autoComplete="off" spellCheck={false} />
                <Button type="button" variant="secondary" className="shrink-0" disabled={!url.trim() || loading} onClick={() => void load()}>
                  {loading && <LoaderCircle data-icon="inline-start" className="motion-safe:animate-spin" aria-hidden />}
                  {loading ? 'Loading…' : 'Load file'}
                </Button>
              </div>
              {error ? <FieldError id="skill-url-error">{error}</FieldError> : <FieldDescription id="skill-url-help">Use a public Markdown file or a GitHub link to it.</FieldDescription>}
            </Field>
          )}
          {hasDraft && (
            <FieldGroup className="gap-3">
              {draft.sourceUrl && (
                <p role="status" className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <Link2 size={13} className="shrink-0" aria-hidden />
                  <span className="truncate" title={draft.sourceUrl}>{draft.sourceUrl}</span>
                </p>
              )}
              <Field className="gap-1.5">
                <FieldLabel htmlFor="canvas-skill-title">Skill name</FieldLabel>
                <Input id="canvas-skill-title" name="skill-name" autoComplete="off" value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })}
                  maxLength={SKILL_TITLE_LIMIT} placeholder="Accessibility review" required />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="canvas-skill-description">When to use it</FieldLabel>
                <Input id="canvas-skill-description" name="skill-description" autoComplete="off" value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.currentTarget.value })}
                  maxLength={SKILL_DESCRIPTION_LIMIT} placeholder="Use when reviewing a screen for accessibility" />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="canvas-skill-text">Instructions</FieldLabel>
                <Textarea id="canvas-skill-text" name="skill-instructions" value={draft.text}
                  onChange={(event) => setDraft({ ...draft, text: event.currentTarget.value })}
                  maxLength={SKILL_TEXT_LIMIT} placeholder="Describe the steps the agent should follow…" className="min-h-44 resize-y" required />
              </Field>
            </FieldGroup>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!canSave || loading}>{skill ? 'Save skill' : 'Install skill'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
