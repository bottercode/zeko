'use client'

import { ChevronDown, Plug } from 'lucide-react'
import { ago } from '@/lib/client/useBoard'
import { AGENT_AWAY_MS, agentIsOnline } from '@/lib/ops'
import type { AgentPresence } from '@/lib/types'
import { AgentAvatar } from './AgentAvatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

type Agent = Pick<AgentPresence, 'name' | 'lastSeen' | 'connectedAt' | 'companion'> & Partial<Pick<AgentPresence, 'working'>>

function presenceLabel(agent: Agent, now: number) {
  if (!agentIsOnline(agent, now)) return now ? `Away · ${ago(agent.lastSeen, now)}` : 'Away'
  if (agent.working && now > 0 && now - agent.lastSeen < AGENT_AWAY_MS) return 'Working'
  return agent.connectedAt ? 'Connected' : 'Available'
}

export function requestRecipient(agents: readonly Agent[], selected: string | null) {
  const chosen = agents.find((agent) => agent.name === selected)
  if (chosen) return chosen
  const companion = agents.find((agent) => agent.companion)
  if (companion) return companion
  return agents.reduce<Agent | undefined>((latest, agent) => {
    return !latest || agent.lastSeen > latest.lastSeen ? agent : latest
  }, undefined)
}

export function RequestAgentPicker({ agents, now, recipient, onSelect, onConnect, className, side }: {
  agents: readonly Agent[]
  now: number
  recipient?: Agent
  onSelect: (name: string) => void
  onConnect: () => void
  className: string
  side?: 'top' | 'bottom'
}) {
  if (!recipient) {
    return (
      <button type="button" onClick={onConnect} className={className}>
        <Plug size={14} className="shrink-0" /> <span className="truncate">Connect an agent</span>
      </button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger type="button" className={className} aria-label={`Recipient: ${recipient.name}`}>
        <AgentAvatar name={recipient.name} size={16} />
        <span className="truncate">{recipient.name}</span>
        <ChevronDown size={12} className="shrink-0 text-mist" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} className="w-52">
        <DropdownMenuRadioGroup value={recipient.name} onValueChange={onSelect} aria-label="Choose a recipient">
          {agents.map((agent) => (
            <DropdownMenuRadioItem key={agent.name} value={agent.name} closeOnClick>
              <AgentAvatar name={agent.name} size={16} />
              <span className="min-w-0 flex-1 truncate">{agent.name}</span>
              <span className="shrink-0 text-xs text-slate">{presenceLabel(agent, now)}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onConnect}><Plug aria-hidden /> Connect an agent</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
