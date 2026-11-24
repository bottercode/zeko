'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import type { Frame } from '@/lib/types'
import { Button, Dialog, IconButton, Kbd } from './kit'
import { Textarea } from './ui/textarea'
import { useStudio } from './studio-context'

export function SketchCodeDialog({ frame, onClose }: { frame: Frame; onClose: () => void }) {
  const { dispatch } = useStudio()
  const [draft, setDraft] = useState<string | null>(null)
  const html = draft ?? frame.html ?? ''
  const dirty = html !== (frame.html ?? '')
  const save = () => {
    if (!dirty) return
    dispatch({ type: 'frame.update', id: frame.id, patch: { html } })
    setDraft(null)
  }

  return (
    <Dialog title={`Edit HTML for ${frame.name}`} onClose={onClose} width="max-w-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-hair px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate font-medium">{frame.name}</h2>
          <p className="text-xs text-slate">Edit HTML</p>
        </div>
        <IconButton label="Close HTML editor" onClick={onClose}><X size={15} /></IconButton>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <Textarea
          aria-label={`HTML of ${frame.name}`}
          value={html}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
              e.preventDefault()
              save()
            }
          }}
          spellCheck={false}
          className="h-[50vh] w-full resize-none rounded-md border border-hair bg-table p-3 font-mono text-xs leading-relaxed"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate">{dirty ? 'Unsaved changes' : 'Saved'}</span>
          <Button disabled={!dirty} onClick={save}>Save <Kbd>⌘S</Kbd></Button>
        </div>
      </div>
    </Dialog>
  )
}
