'use client'

import { useState } from 'react'
import { Check, Copy, Sparkles, Terminal } from 'lucide-react'
import { CLI_INSTALL_COMMAND } from '@/lib/cli-release'
import { useAcpStatus } from './AcpComposerOptions'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'

export function AcpConnection({ openAgents }: { openAgents?: () => void }) {
  const { hosted, connected } = useAcpStatus()
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)

  if (!hosted) return openAgents ? <Button onClick={openAgents}><Sparkles data-icon="inline-start" aria-hidden /> Open agent chat</Button> : null
  if (connected && openAgents && !open) return <Button onClick={openAgents}><Check data-icon="inline-start" aria-hidden /> CLI connected · Open chat</Button>

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" size={openAgents ? 'default' : 'sm'} variant={openAgents ? 'default' : 'ghost'} />}>
        {connected ? <Check data-icon="inline-start" aria-hidden className="text-live" /> : <Terminal data-icon="inline-start" aria-hidden />}
        {connected ? 'CLI connected' : 'Connect CLI'}
      </DialogTrigger>
      <DialogContent className="gap-4 p-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Zeko CLI</DialogTitle>
          <DialogDescription>Use Codex or Claude Code on this computer from Zeko chat.</DialogDescription>
        </DialogHeader>
        {connected ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="flex items-center gap-2 text-sm text-live"><Check size={15} aria-hidden /> CLI connected</p>
            {openAgents && <Button type="button" onClick={() => { setOpen(false); openAgents() }}>Open agent chat</Button>}
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-2.5">
              <code className="min-w-0 flex-1 py-1 text-xs leading-relaxed wrap-anywhere">{CLI_INSTALL_COMMAND}</code>
              <Button type="button" size="icon-sm" variant="outline" aria-label={copied ? 'Copied install command' : 'Copy install command'} onClick={() => {
                void navigator.clipboard.writeText(CLI_INSTALL_COMMAND).then(() => setCopied(true)).catch(() => setCopied(false))
              }}>{copied ? <Check aria-hidden /> : <Copy aria-hidden />}</Button>
            </div>
            <p className="text-sm text-muted-foreground">With Node.js 22 or later, run <code className="text-foreground">zeko</code> once and approve the connection in your browser.</p>
            <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-current" /> Waiting for the CLI</p>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
