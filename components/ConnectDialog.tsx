'use client'

import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { Check, Copy, Link2, Plug, Terminal } from 'lucide-react'
import { CLI_INSTALL_COMMAND } from '@/lib/cli-release'
import { ago } from '@/lib/client/useBoard'
import { AGENT_AWAY_MS } from '@/lib/ops'
import type { AgentPresence } from '@/lib/types'
import { AgentAvatar } from './AgentAvatar'
import { ChoiceSelect } from './ChoiceSelect'
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
    snippet: (url: string, token?: string) => `claude mcp add --transport http zeko "${url}"${token ? ` --header "Authorization: Bearer ${token}"` : ''}`,
  },
  {
    id: 'codex',
    name: 'Codex',
    agent: 'Codex',
    setup: 'Run this in your terminal to register the Zeko canvas with Codex.',
    check: 'Start a new Codex session and check that zeko is enabled in /mcp.',
    copy: 'Copy command',
    snippet: (url: string, token?: string) => token
      ? `export ZEKO_MCP_TOKEN="${token}"\ncodex mcp add zeko --url "${url}" --bearer-token-env-var ZEKO_MCP_TOKEN`
      : `codex mcp add zeko --url "${url}"`,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    agent: 'Cursor',
    setup: 'Add the zeko entry under mcpServers in .cursor/mcp.json.',
    check: 'Open Cursor’s MCP settings, enable zeko, and start an Agent chat.',
    copy: 'Copy JSON',
    snippet: (url: string, token?: string) => JSON.stringify({ mcpServers: { zeko: { url, ...(token && { headers: { Authorization: `Bearer ${token}` } }) } } }, null, 2),
  },
  {
    id: 'other',
    name: 'Other',
    agent: 'Agent',
    setup: 'Add a server named zeko in your client’s MCP settings. Choose Streamable HTTP.',
    check: 'Save and enable the server in your client.',
    copy: 'Copy URL',
    snippet: (url: string, token?: string) => token ? `${url}\nAuthorization: Bearer ${token}` : url,
  },
] as const

const TEST_PROMPT = 'Can you tell me which canvas I have open in Zeko?'
type Credential = { token?: string; error?: boolean } | null

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

function CopyBlock({ text, display = text, action, prompt = false }: { text: string; display?: string; action: string; prompt?: boolean }) {
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
          <pre className="w-full min-w-0 px-0.5 py-1 font-mono text-xs leading-relaxed wrap-anywhere whitespace-pre-wrap text-ink sm:w-auto sm:flex-1"><code>{display}</code></pre>
        )}
        <Button variant={prompt ? 'ghost' : 'secondary'} size="sm" onClick={copy} className="ml-auto min-w-24">
          {state === 'copied' ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {state === 'copied' ? 'Copied' : action}
        </Button>
      </div>
      <p role="status" className={state === 'failed' ? 'mt-1.5 text-xs text-slate' : 'sr-only'}>
        {state === 'failed' ? display === text ? 'Clipboard unavailable. Select and copy the text above.' : 'Clipboard unavailable. Allow clipboard access and try again.' : state === 'copied' ? 'Copied to clipboard.' : ''}
      </p>
    </div>
  )
}

function CliSetup({ origin, hosted, credential, retry, canvas, agents, prompt }: {
  origin: string
  hosted: boolean
  credential: Credential
  retry: () => void
  canvas?: { id: string }
  agents: readonly Pick<AgentPresence, 'name' | 'companion'>[]
  prompt: string
}) {
  const [provider, setProvider] = useState('codex')
  const flags = `--provider ${provider} --url "${origin}"`
  const boardFlag = canvas ? ` --board "${canvas.id}"` : ''
  const token = credential?.token
  const connected = agents.some((agent) => agent.name.toLowerCase() === provider && agent.companion)
  return (
    <div className="editor-content flex flex-col gap-5 px-4 py-5 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">Coding agent</span>
        <ChoiceSelect label="Coding agent" value={provider} onChange={setProvider} options={[
          { value: 'codex', label: 'Codex' },
          { value: 'claude', label: 'Claude Code' },
        ]} />
      </div>
      <SetupStep number={1} title="Install the Zeko CLI" description="Run this in your terminal once. Requires Node.js 20.9 or later.">
        <CopyBlock text={CLI_INSTALL_COMMAND} action="Copy install" />
      </SetupStep>
      {hosted && <SetupStep number={2} title="Connect your workspace" description="Run the setup command, then paste the token when the terminal prompts you.">
        {!credential ? (
          <p role="status" className="text-sm text-muted-foreground">Getting connection details…</p>
        ) : credential.error ? (
          <Button variant="outline" onClick={retry}>Retry</Button>
        ) : token ? (
          <div className="flex flex-col gap-2">
            <CopyBlock text={`zeko connect ${flags}${boardFlag}`} action="Copy setup" />
            <CopyBlock text={token} display="Private workspace token" action="Copy token" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Sign in with Google to connect the hosted workspace.</p>
        )}
      </SetupStep>}
      {(!hosted || token) && <SetupStep number={hosted ? 3 : 2} title="Open your agent" description="Run this in your project. Sign in to the coding agent first if prompted.">
        <div className="flex flex-col gap-2">
          <CopyBlock text={`zeko launch ${flags}${!hosted ? boardFlag : ''}`} action="Copy launch" />
          {connected && <p role="status" className="flex items-center gap-2 text-xs text-live"><Check size={13} aria-hidden /> CLI connected</p>}
          <CopyBlock text={prompt} action="Copy prompt" prompt />
        </div>
      </SetupStep>}
    </div>
  )
}

export function ConnectDialog({ open, onOpenChange, trigger, agents, now, canvas }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger?: ReactElement
  agents: readonly Pick<AgentPresence, 'name' | 'mcpConnectedAt' | 'companion'>[]
  now: number
  canvas?: { id: string; name: string }
}) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const hosted = origin.startsWith('https:')
  const [credential, setCredential] = useState<Credential>(null)

  useEffect(() => {
    if (!open || !hosted || credential) return
    const controller = new AbortController()
    void fetch('/api/mcp/credential', { method: 'POST', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) { setCredential({}); return }
        if (!response.ok) throw new Error('MCP credential unavailable')
        const { token } = await response.json() as { token: string }
        setCredential({ token })
      })
      .catch(() => { if (!controller.signal.aborted) setCredential({ error: true }) })
    return () => controller.abort()
  }, [open, hosted, credential])

  const token = credential?.token
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
            <DialogTitle className="text-lg font-semibold tracking-tight">Connect an agent</DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-relaxed text-slate">
              Choose how your coding agent connects to your canvas.
            </DialogDescription>
          </div>
        </header>
        <Tabs defaultValue={hosted ? 'cli' : 'codex'} className="gap-0">
          <TabsList aria-label="Coding tool" activateOnFocus className="mx-4 grid w-auto grid-cols-2 gap-1 self-stretch p-1 group-data-horizontal/tabs:h-auto sm:mx-6 sm:grid-cols-5">
            <TabsTrigger value="cli" className="h-11 gap-2"><Terminal aria-hidden /> Zeko CLI</TabsTrigger>
            {CLIENTS.map(({ id, name, agent }) => (
              <TabsTrigger key={id} value={id} className="h-11 gap-2">
                {id === 'other' ? <Link2 aria-hidden className="size-5" strokeWidth={1.75} /> : <AgentAvatar name={agent} size={24} />}
                {name}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="cli">
            <CliSetup origin={origin} hosted={hosted} credential={credential} retry={() => setCredential(null)} canvas={canvas} agents={agents} prompt={prompt} />
          </TabsContent>
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
                    {hosted && !credential ? (
                      <p role="status" className="text-sm text-slate">Getting connection details…</p>
                    ) : credential?.error ? (
                      <Button variant="outline" onClick={() => setCredential(null)}>Retry</Button>
                    ) : (
                      <CopyBlock text={client.snippet(url, token)} display={client.snippet(url, token ? 'YOUR_WORKSPACE_TOKEN' : undefined)} action={token && client.id === 'other' ? 'Copy connection details' : client.copy} />
                    )}
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
                <p className="border-t border-hair bg-lightbox/70 px-4 py-3 text-xs text-slate sm:px-6">
                  {token ? 'The copied connection includes a private workspace token that expires in 30 days.' : 'Keep Zeko running while the agent works.'}
                </p>
              </TabsContent>
            )
          })}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
