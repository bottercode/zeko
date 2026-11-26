'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Brain, ChevronDown, Cpu, SlidersHorizontal } from 'lucide-react'
import { ACP_AGENTS, type AcpAgentId, type AcpAgentStatus, type AcpCapabilities, type AcpChoice, type AcpOption, type AcpSettings } from '@/lib/acp'
import { AgentAvatar } from './AgentAvatar'
import { Button } from './ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from './ui/select'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup,
  DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from './ui/dropdown-menu'

const triggerStyle = 'editor-control min-w-0 max-w-36 border-0 px-1.5 text-xs dark:bg-transparent dark:hover:bg-transparent'
const defaults = ACP_AGENTS.map(({ id, name }) => ({ id, name, available: false }))
type AcpStatus = { agents: AcpAgentStatus[]; hosted: boolean; connected: boolean }
const initialStatus: AcpStatus = { agents: defaults, hosted: false, connected: false }
let acpStatus = initialStatus
const statusListeners = new Set<() => void>()
let events: EventSource | undefined
let initialRequest: AbortController | undefined

const CACHE_KEY = 'zeko.acp.options.v1'
type Catalog = Record<string, AcpOption[]>
const emptyCatalog: Catalog = {}
let catalog = emptyCatalog
let hydrated = false
const listeners = new Set<() => void>()

function publishCatalog(next: Catalog) {
  catalog = { ...catalog, ...next }
  if (!acpStatus.hosted) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(catalog)) } catch {}
  }
  listeners.forEach((listener) => listener())
}

function subscribeCatalog(listener: () => void) {
  listeners.add(listener)
  if (!hydrated) {
    hydrated = true
    try { publishCatalog(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as Catalog) } catch {}
  }
  return () => { listeners.delete(listener) }
}

function publishStatus(next: AcpStatus) {
  if (next.hosted && !acpStatus.hosted) {
    catalog = emptyCatalog
    listeners.forEach((listener) => listener())
  }
  acpStatus = next
  statusListeners.forEach((listener) => listener())
}

function subscribeStatus(listener: () => void) {
  statusListeners.add(listener)
  if (!events) {
    events = new EventSource('/api/acp/events')
    events.onmessage = (event) => publishStatus(JSON.parse(event.data) as AcpStatus)
    events.onerror = () => {
      if (acpStatus.hosted && acpStatus.connected) publishStatus({
        ...acpStatus, connected: false, agents: defaults,
      })
    }
    const abort = new AbortController()
    initialRequest = abort
    void fetch('/api/acp', { signal: abort.signal })
      .then((response) => response.json())
      .then((data: { catalog?: Catalog }) => {
        if (abort.signal.aborted) return
        if (data.catalog) publishCatalog(data.catalog)
      }).catch(() => {})
  }
  return () => {
    statusListeners.delete(listener)
    if (statusListeners.size) return
    initialRequest?.abort()
    events?.close()
    events = undefined
  }
}

export function useAcpStatus() {
  return useSyncExternalStore(subscribeStatus, () => acpStatus, () => initialStatus)
}

export function useAcpAgents() {
  return useAcpStatus().agents
}

export function useAcpOptions(agent: AcpAgentId, settings: AcpSettings) {
  const agents = useAcpAgents()
  const profiles = useSyncExternalStore(subscribeCatalog, () => catalog, () => emptyCatalog)
  const modelId = profiles[agent]?.find((option) => option.category === 'model')?.id ?? 'model'
  const model = typeof settings[modelId] === 'string' ? settings[modelId] : undefined
  const key = model ? `${agent}:${model}` : agent
  const [failure, setFailure] = useState<{ key: string; message: string }>()
  const [refreshing, setRefreshing] = useState<string>()
  const available = agents.some((candidate) => candidate.id === agent && candidate.available)

  const refresh = async () => {
    setRefreshing(key)
    try {
      const [base, selected] = await Promise.all([
        fetchOptions(agent, modelId, undefined, true),
        model ? fetchOptions(agent, modelId, model, true) : undefined,
      ])
      publishCatalog({ [agent]: base.options, ...(selected ? { [key]: selected.options } : {}) })
      setFailure((current) => current?.key === key ? undefined : current)
    } catch (error) {
      setFailure({ key, message: error instanceof Error ? error.message : 'Couldn’t refresh the models.' })
    } finally {
      setRefreshing((current) => current === key ? undefined : current)
    }
  }

  useEffect(() => {
    if (!available) return
    const abort = new AbortController()
    void fetchOptions(agent, modelId, model, false, abort.signal).then((data) => {
      if (abort.signal.aborted) return
      publishCatalog({ [key]: data.options })
      setFailure((current) => current?.key === key ? undefined : current)
    }).catch((error: Error) => {
      if (!abort.signal.aborted) setFailure({ key, message: error.message })
    })
    return () => abort.abort()
  }, [agent, available, modelId, model, key])

  return {
    agents,
    available,
    options: profiles[key] ?? profiles[agent] ?? [],
    error: failure?.key === key ? failure.message : undefined,
    refreshing: refreshing === key,
    refresh,
  }
}

async function fetchOptions(
  agent: AcpAgentId, modelId: string, model: string | undefined, refresh: boolean, signal?: AbortSignal,
) {
  const response = await fetch('/api/acp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent, settings: model ? { [modelId]: model } : {}, refresh }),
    signal,
  })
  const data = await response.json() as AcpCapabilities & { error?: string }
  if (!response.ok) throw new Error(data.error ?? 'Couldn’t connect to the agent.')
  return data
}

export function AcpAgentPicker({ agents, selected, onSelect }: {
  agents: AcpAgentStatus[]; selected: AcpAgentId; onSelect: (id: AcpAgentId) => void
}) {
  const name = agents.find((agent) => agent.id === selected)?.name ?? 'Choose agent'
  return (
    <Select items={agents.map((agent) => ({ value: agent.id, label: agent.name }))} value={selected}
      onValueChange={(id) => { if (id !== null) onSelect(id) }}>
      <SelectTrigger size="sm" aria-label={`Agent: ${name}`} className={triggerStyle}>
        <AgentAvatar name={name} size={16} />
        <SelectValue />
      </SelectTrigger>
      <SelectContent side="top" align="end" alignItemWithTrigger={false} className="w-56">
        <SelectGroup>
          <SelectLabel>ACP agents</SelectLabel>
          {agents.map((agent) => (
            <SelectItem key={agent.id} value={agent.id} disabled={!agent.available}>
              <AgentAvatar name={agent.name} size={16} />
              <span className="min-w-0 flex-1 truncate">{agent.name}</span>
              {!agent.available && <span className="text-xs text-muted-foreground">Unavailable</span>}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function AcpOptionPicker({ option, settings, onChange }: {
  option: AcpOption; settings: AcpSettings; onChange: (id: string, value: string | boolean) => void
}) {
  const selected = settings[option.id]
  const choice = option.type === 'select' && (option.choices.find(({ value }) => value === selected) || option.choices.find(({ value }) => value === option.value))
  const Icon = option.category === 'model' ? Cpu : option.category === 'thought_level' ? Brain : SlidersHorizontal
  const checked = option.type === 'boolean' && (typeof selected === 'boolean' ? selected : option.value)
  const title = choice ? choice.name : option.type === 'boolean' ? (checked ? 'On' : 'Off') : option.name
  const label = option.type === 'boolean' ? option.name : option.category === 'speed' ? `${option.name} ${title.toLowerCase()}` : title
  const names = new Set<string>()
  const values = new Set<string>()
  const choices = option.type === 'select' ? option.choices.filter((item) => {
    const name = item.name.trim().toLowerCase()
    if (names.has(name) || values.has(item.value)) return false
    names.add(name)
    values.add(item.value)
    return true
  }) : []
  const main = choices.filter((item) => !item.more)
  const more = main.length ? choices.filter((item) => item.more) : []
  if (option.type === 'select' && !more.length) {
    return (
      <Select items={choices.map(({ value, name }) => ({ value, label: name }))} value={choice ? choice.value : null}
        onValueChange={(value) => { if (value !== null) onChange(option.id, value) }}>
        <SelectTrigger size="sm" aria-label={`${option.name}: ${title}`} title={option.description || option.name} className={triggerStyle}>
          <Icon aria-hidden className="text-muted-foreground" />
          <SelectValue placeholder={option.name}>{label}</SelectValue>
        </SelectTrigger>
        <SelectContent side="top" align="end" alignItemWithTrigger={false}>
          <SelectGroup>
            <SelectLabel>{option.name}</SelectLabel>
            {choices.map(({ value, name, description }) => (
              <SelectItem value={value} key={value} title={description ?? undefined}>{name}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    )
  }
  const rows = (items: AcpChoice[]) => (
    <DropdownMenuRadioGroup value={choice ? choice.value : String(option.value)} onValueChange={(value) => onChange(option.id, value)}>
      {items.map(({ value, name, description }) => (
        <DropdownMenuRadioItem key={value} value={value} title={description ?? undefined} closeOnClick>
          <span className="whitespace-normal">{name}</span>
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger title={option.description || option.name} aria-label={`${option.name}: ${title}`} render={<Button variant="ghost" size="sm" className={triggerStyle} />}>
        <Icon data-icon="inline-start" aria-hidden className="text-muted-foreground" />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown data-icon="inline-end" aria-hidden className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="max-h-[min(44dvh,24rem)] w-64 overflow-y-auto">
        <DropdownMenuGroup><DropdownMenuLabel>{option.name}</DropdownMenuLabel></DropdownMenuGroup>
        {option.type === 'boolean' ? (
          <DropdownMenuCheckboxItem checked={checked} onCheckedChange={(value) => onChange(option.id, value)} closeOnClick>
            {option.name}
          </DropdownMenuCheckboxItem>
        ) : rows(main.length ? main : choices)}
        {more.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More models</DropdownMenuSubTrigger>
              <DropdownMenuSubContent side="left" className="max-h-[min(44dvh,24rem)] w-52 overflow-y-auto">
                {rows(more)}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
