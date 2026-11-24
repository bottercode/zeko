'use client'

import { useId, useRef, useState } from 'react'
import { Globe } from 'lucide-react'
import { parseWebsiteUrl } from '@/lib/ops'
import { Button } from './ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from './ui/field'
import { Input } from './ui/input'

export function WebsiteDialog({ address, onSave, onClose }: {
  address?: string
  onSave: (url: URL) => void
  onClose: () => void
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(address ?? '')
  const [invalid, setInvalid] = useState(false)

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent initialFocus={input}>
        <form className="flex flex-col gap-4" onSubmit={(event) => {
          event.preventDefault()
          const url = parseWebsiteUrl(value)
          if (url) onSave(url)
          else {
            setInvalid(true)
            input.current?.focus()
          }
        }}>
          <DialogHeader>
            <DialogTitle>{address === undefined ? 'Add website' : 'Edit website URL'}</DialogTitle>
            <DialogDescription>Load a live webpage on your canvas.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor={id}>Website URL</FieldLabel>
              <Input id={id} ref={input} inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://example.com"
                value={value} onChange={(event) => { setValue(event.target.value); setInvalid(false) }}
                aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined} />
              {invalid && <FieldError id={`${id}-error`}>Enter a valid HTTP or HTTPS website URL.</FieldError>}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit"><Globe data-icon="inline-start" aria-hidden /> Load website</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
