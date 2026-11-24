'use client'

import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { Check, Copy, Link2, Plug } from 'lucide-react'
import { ago } from '@/lib/client/useBoard'
import { AGENT_AWAY_MS } from '@/lib/ops'
import type { AgentPresence } from '@/lib/types'
import { AgentAvatar } from './AgentAvatar'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { cx } from './kit'

const CLIENTS = [
  {
    id: 'claude',
    name: 'Claude Code',
    agent: 'Claude',
    setup: 'Run this in the project where you use Claude Code.',
    check: 'Open Claude Code and check that zeko is enabled in /mcp.',
    copy: 'Copy command',
    snippet: (url: string) => `claude mcp add --transport http zeko "${url}"`,
  },
  {
    id: 'codex',
    name: 'Codex',
    agent: 'Codex',
    setup: 'Run this in your terminal to register the Zeko canvas with Codex.',
    check: 'Start a new Codex session and check that zeko is enabled in /mcp.',
    copy: 'Copy command',
    snippet: (url: string) => `codex mcp add zeko --url "${url}"`,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    agent: 'Cursor',
    setup: 'Add the zeko entry under mcpServers in .cursor/mcp.json.',
    check: 'Open Cursor’s MCP settings, enable zeko, and start an Agent chat.',
    copy: 'Copy JSON',
    snippet: (url: string) => JSON.stringify({ mcpServers: { zeko: { url } } }, null, 2),
  },
  {
    id: 'other',
    name: 'Other',
    agent: 'Agent',
    setup: 'Add a server named zeko in your client’s MCP settings. Choose Streamable HTTP and paste this URL.',
    check: 'Save and enable the server in your client.',
    copy: 'Copy URL',
    snippet: (url: string) => url,
  },
] as const

const TEST_PROMPT = 'Can you tell me which canvas I have open in Zeko?'

function SetupStep({ number, title, description, children }: { number: number; title: string; description: string; children?: ReactNode }) {
  return (
    <section className="grid grid-cols-[1.375rem_minmax(0,1fr)] gap-x-2.5">
      <span className="grid size-[1.375rem] place-items-center rounded-full bg-wash text-xs font-semibold text-ink" aria-hidden>{number}</span>
      <div className="min-w-0">
        <h3 className="pt-0.5 font-semibold text-ink">{title}</h3>
        <p className="mt-1 mb-2 text-sm leading-relaxed text-slate">{description}</p>
        {children}
      </div>
    </section>
  )
}

function CopyBlock({ text, action, prompt = false }: { text: string; action: string; prompt?: boolean }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (state !== 'copied') return
    const timer = window.setTimeout(() => setState('idle'), 2200)
    return () => window.clearTimeout(timer)
  }, [state])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-hair bg-table p-2.5 sm:flex-nowrap">
        {prompt ? (
          <p className="min-w-0 flex-1 px-0.5 py-1 text-sm leading-relaxed text-ink">{text}</p>
        ) : (
          <pre className="w-full min-w-0 px-0.5 py-1 font-mono text-xs leading-relaxed wrap-anywhere whitespace-pre-wrap text-ink sm:w-auto sm:flex-1"><code>{text}</code></pre>
        )}
        <Button variant={prompt ? 'ghost' : 'secondary'} size="sm" onClick={copy} className="ml-auto min-w-24">
          {state === 'copied' ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {state === 'copied' ? 'Copied' : action}
        </Button>
      </div>
      <p role="status" className={state === 'failed' ? 'mt-1.5 text-xs text-slate' : 'sr-only'}>
        {state === 'failed' ? 'Clipboard unavailable. Select and copy the text above.' : state === 'copied' ? 'Copied to clipboard.' : ''}
      </p>
    </div>
  )
}

export function ConnectDialog({ open, onOpenChange, trigger, agents, now, canvas }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger?: ReactElement
  agents: readonly Pick<AgentPresence, 'name' | 'mcpConnectedAt'>[]
  now: number
  canvas?: { id: string; name: string }
}) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const prompt = canvas
    ? `Please work on my “${canvas.name}” canvas in Zeko (canvas ID ${canvas.id}). Tell me when you’re ready.`
    : TEST_PROMPT

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger render={trigger} />}
      <DialogContent className="block max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl p-0 shadow-pop sm:max-w-xl motion-reduce:animate-none">
        <header className="flex items-start gap-3 px-4 pt-5 pb-4 sm:px-6">
          <div aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-grease-soft text-[#ff8ba2]">
            <Plug size={19} strokeWidth={1.75} />
          </div>
          <div className="min-w-0 pt-0.5 pr-6">
            <DialogTitle className="text-lg font-semibold tracking-tight">MCP connection</DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-relaxed text-slate">
              Give an external coding tool access to your Zeko canvas.
            </DialogDescription>
          </div>
        </header>
        <Tabs defaultValue="codex" className="gap-0">
          <TabsList aria-label="Coding tool" activateOnFocus className="mx-4 grid w-auto grid-cols-2 gap-1 self-stretch p-1 group-data-horizontal/tabs:h-auto sm:mx-6 sm:grid-cols-4">
            {CLIENTS.map(({ id, name, agent }) => (
              <TabsTrigger key={id} value={id} className="h-11 gap-2">
                {id === 'other' ? <Link2 aria-hidden className="size-5" strokeWidth={1.75} /> : <AgentAvatar name={agent} size={30} />}
                {name}
              </TabsTrigger>
            ))}
          </TabsList>
          {CLIENTS.map((client) => {
            const url = `${origin}/api/mcp?${new URLSearchParams({ as: client.agent, ...(canvas ? { board: canvas.id } : {}) })}`
            const agent = agents.find((agent) => agent.name === client.agent)
            const connected = agent?.mcpConnectedAt
            const online = !!connected && (now <= 0 || now - connected < AGENT_AWAY_MS)
            const name = client.id === 'other' ? client.agent : client.name
            const status = online
              ? `${name} connected over MCP`
              : connected && now > 0 ? `${name} seen ${ago(connected, now)}` : `Waiting for ${name} to connect`
            return (
              <TabsContent key={client.id} value={client.id}>
                <div className="editor-content flex flex-col gap-5 px-4 py-5 sm:px-6">
                  <SetupStep number={1} title="Add Zeko" description={client.setup}>
                    <CopyBlock text={client.snippet(url)} action={client.copy} />
                  </SetupStep>
                  <SetupStep number={2} title="Check the connection" description={client.check}>
                    <div role="status" className={cx('flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs', online ? 'border-live/20 bg-live/8 text-live' : 'border-hair bg-lightbox text-slate')}>
                      <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', online ? 'bg-live' : 'bg-mist')} />
                      {status}
                    </div>
                  </SetupStep>
                  <SetupStep number={3} title={canvas ? 'Point it at this canvas' : 'Open a canvas'} description={canvas ? 'Paste this into the external tool’s chat.' : 'Open a canvas in Zeko, then paste this into the external tool’s chat.'}>
                    <CopyBlock text={prompt} action="Copy prompt" prompt />
                  </SetupStep>
                </div>
                <p className="border-t border-hair bg-lightbox/70 px-4 py-3 text-xs text-slate sm:px-6">Keep Zeko running while the agent works.</p>
              </TabsContent>
            )
          })}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
