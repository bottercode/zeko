'use client'

import { useId, type ReactNode } from 'react'
import { Ellipsis, type LucideIcon } from 'lucide-react'
import { Button } from './ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu'
import { Field, FieldGroup, FieldLabel } from './ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group'
import { Separator } from './ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

export const propertyInput = 'w-full min-w-0'

export function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

export function InspectorSection({ title, icon: Icon, summary, children }: {
  title: string
  icon?: LucideIcon
  summary?: ReactNode
  children: ReactNode
}) {
  const heading = useId()
  return (
    <section aria-labelledby={heading} className="inspector-section px-3.5 py-3">
      <div className="mb-2.5 flex min-w-0 items-center gap-2">
        {Icon && <Icon size={14} strokeWidth={1.75} className="shrink-0 text-muted-foreground" aria-hidden />}
        <h4 id={heading} className="min-w-0 flex-1 text-xs font-semibold text-foreground">{title}</h4>
        {summary != null && <span className="max-w-32 truncate text-xs text-muted-foreground tabular-nums">{summary}</span>}
      </div>
      <FieldGroup className="gap-2">{children}</FieldGroup>
    </section>
  )
}

interface InspectorView {
  id: string
  label: string
  content: ReactNode
}

export function InspectorViews({ header, views, initialView }: {
  header: ReactNode
  views: InspectorView[]
  initialView?: string
}) {
  return (
    <Tabs defaultValue={initialView ?? views[0]?.id} className="min-h-0 flex-1 gap-0">
      <div className="shrink-0">
        {header}
        <div className="px-3.5 pb-2.5">
          <TabsList aria-label="Inspector views" className="w-full" activateOnFocus>
            {views.map(({ id, label }) => <TabsTrigger key={id} value={id}>{label}</TabsTrigger>)}
          </TabsList>
        </div>
        <Separator className="editor-divider" />
      </div>
      {views.map(({ id, content }) => (
        <TabsContent key={id} value={id} className="min-h-0 overflow-y-auto overscroll-contain focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset">
          {content}
        </TabsContent>
      ))}
    </Tabs>
  )
}

export function SelectionHeader({ name, detail, icon, actions, children }: {
  name: string
  detail: ReactNode
  icon: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="px-3.5 pt-3 pb-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground">{icon}</div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold" title={name}>{name}</h3>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">{detail}</div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      </div>
      {children && <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{children}</div>}
    </div>
  )
}

export function InspectorMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} />}>
        <Ellipsis aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

export function NumberProperty({ label, value, unit = 'px', allowCss = false, normalize, onCommit }: {
  label: string
  value: string
  unit?: string
  allowCss?: boolean
  normalize?: (value: string) => string | null
  onCommit: (value: string) => void
}) {
  const id = useId()
  return (
    <Field className="min-w-0 gap-1">
      <FieldLabel htmlFor={id} className="text-xs text-muted-foreground">{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id={id}
          name={label}
          key={value}
          defaultValue={value}
          autoComplete="off"
          spellCheck={false}
          inputMode={allowCss ? undefined : 'decimal'}
          className="min-w-0 font-mono text-xs tabular-nums"
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => {
            const input = event.currentTarget
            const raw = input.value.trim()
            const next = raw && raw !== value ? (normalize ? normalize(raw) : raw) : null
            if (next === null) input.value = value
            else onCommit(next)
          }}
          onKeyDown={(event) => {
            const input = event.currentTarget
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              if (event.key === 'Escape') input.value = value
              input.blur()
              return
            }
            if (!['ArrowUp', 'ArrowDown'].includes(event.key) || !/^-?\d+(\.\d+)?$/.test(input.value.trim())) return
            event.preventDefault()
            const step = event.shiftKey ? 10 : 1
            input.value = String(Math.round((Number(input.value) + (event.key === 'ArrowUp' ? step : -step)) * 100) / 100)
          }}
        />
        {unit && <InputGroupAddon align="inline-end" aria-hidden className="text-xs">{unit}</InputGroupAddon>}
      </InputGroup>
    </Field>
  )
}
