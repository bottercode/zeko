'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { newId } from '@/lib/client/useBoard'
import { DEFAULT_THEME, defaultDesign, tokenLabels, tokenValue, validTokenName, validTokenValue } from '@/lib/tokens'
import type { TokenKind } from '@/lib/types'
import { Button, Heading, IconButton } from './kit'
import { ChoiceSelect } from './ChoiceSelect'
import { Input } from './ui/input'
import { useStudio } from './studio-context'
import { Separator } from './ui/separator'

const field = 'h-8 min-w-0 rounded-md border border-hair bg-panel px-2 text-sm focus-visible:outline focus-visible:outline-grease'

export function TokensPanel() {
  const { board, dispatch, toast } = useStudio()
  const design = board.design ?? defaultDesign
  const [themeName, setThemeName] = useState<string | null>(null)
  const [addingToken, setAddingToken] = useState(false)
  const [kind, setKind] = useState<TokenKind>('color')
  const [name, setName] = useState('')
  const [value, setValue] = useState('')

  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
      <Heading action={<IconButton label="Add theme" active={themeName !== null} onClick={() => setThemeName(themeName === null ? '' : null)} className="size-6"><Plus size={14} /></IconButton>}>Theme</Heading>
      <ChoiceSelect label="Active theme" value={design.themeId} className="w-full"
        options={design.themes.map((theme) => ({ value: theme.id, label: theme.name }))}
        onChange={(id) => dispatch({ type: 'design.theme.select', id })} />
      {themeName !== null && (
        <form className="mt-2 flex gap-1.5" onSubmit={(e) => {
          e.preventDefault()
          const label = themeName.trim()
          if (!label) return
          dispatch({ type: 'design.theme.add', id: newId(), name: label })
          setThemeName(null)
        }}>
          <Input aria-label="Theme name" value={themeName} onChange={(e) => setThemeName(e.currentTarget.value)} className={`${field} flex-1`} placeholder="Theme name" maxLength={64} />
          <Button size="sm" type="submit">Add</Button>
        </form>
      )}

      <Separator className="editor-divider my-3" />
      <Heading action={<IconButton label="Add token" active={addingToken} onClick={() => setAddingToken(!addingToken)} className="size-6"><Plus size={14} /></IconButton>}>Tokens</Heading>
      {!addingToken && design.tokens.length === 0 && <p className="py-2 text-sm text-slate">Add shared colors, spacing, or type to use across this canvas.</p>}
      {addingToken && <form className="editor-content flex flex-col gap-1.5" onSubmit={(e) => {
        e.preventDefault()
        const property = name.trim().toLowerCase().replace(/^--/, '')
        if (!validTokenName(property) || !validTokenValue(value.trim())) return toast('Enter a CSS token name and value.')
        if (design.tokens.some((token) => token.name === property)) return toast('That token already exists.')
        dispatch({ type: 'design.token.set', name: property, kind, themeId: design.themeId, value })
        setName('')
        setValue('')
        setAddingToken(false)
      }}>
        <ChoiceSelect label="Token type" value={kind} onChange={setKind} className="w-full"
          options={Object.entries(tokenLabels).map(([id, label]) => ({ value: id as TokenKind, label }))} />
        <div className="grid grid-cols-2 gap-1.5">
          <Input aria-label="Token name" value={name} onChange={(e) => setName(e.currentTarget.value)} className={field} placeholder="brand" maxLength={64} />
          <Input aria-label="Token value" value={value} onChange={(e) => setValue(e.currentTarget.value)} className={field} placeholder="CSS value" maxLength={256} />
        </div>
        <Button type="submit" size="sm">Add token</Button>
      </form>}

      <ul className="mt-3 flex flex-col gap-2">
        {design.tokens.map((token) => {
          const own = token.values[design.themeId] ?? ''
          const fallback = design.themeId === DEFAULT_THEME ? undefined : tokenValue(token, DEFAULT_THEME)
          return (
            <li key={token.name} className="rounded-md border border-hair p-2">
              <div className="flex items-center justify-between gap-1">
                <span className="truncate font-mono text-xs">--{token.name}</span>
                <IconButton label={`Remove token --${token.name}`} onClick={() => dispatch({ type: 'design.token.remove', name: token.name })}><Trash2 size={13} /></IconButton>
              </div>
              <Input
                key={`${design.themeId}:${own}`}
                aria-label={`Value for --${token.name}`}
                defaultValue={own}
                placeholder={fallback}
                maxLength={256}
                className={`${field} w-full font-mono`}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                onBlur={(e) => {
                  const next = e.currentTarget.value.trim()
                  if (next === own) return
                  if (!validTokenValue(next) && (next || design.themeId === DEFAULT_THEME)) {
                    e.currentTarget.value = own
                    return toast('Enter a valid CSS value.')
                  }
                  dispatch({ type: 'design.token.set', name: token.name, kind: token.kind, themeId: design.themeId, value: next })
                }}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
