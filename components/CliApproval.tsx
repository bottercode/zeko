'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, Terminal } from 'lucide-react'
import { Button, buttonVariants } from './ui/button'

export function CliApproval({ code }: { code?: string }) {
  const [state, setState] = useState<'ready' | 'connecting' | 'approved'>('ready')
  const [error, setError] = useState('')

  const approve = async () => {
    if (state !== 'ready' || !code) return
    setState('connecting')
    setError('')
    try {
      const response = await fetch('/api/acp/pair', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!response.ok) throw new Error()
      setState('approved')
    } catch {
      setError('Couldn’t connect this CLI. Try again from the terminal.')
      setState('ready')
    }
  }

  return (
    <main className="grid h-dvh place-items-center px-6">
      <section className="flex w-full max-w-md flex-col items-start gap-4 rounded-2xl border border-border bg-card p-6 sm:p-8">
        {state === 'approved' ? <Check size={24} aria-hidden className="text-live" /> : <Terminal size={24} aria-hidden />}
        <h1 className="text-2xl font-semibold tracking-tight">{state === 'approved' ? 'CLI approved' : 'Connect Zeko CLI'}</h1>
        {state === 'approved' ? (
          <>
            <p className="text-sm text-muted-foreground">The CLI will connect in a moment. You can return to your canvas.</p>
            <Link href="/" className={buttonVariants()}>Open workspace</Link>
          </>
        ) : code ? (
          <>
            <p className="text-sm text-muted-foreground">Confirm that this code matches the one in your terminal.</p>
            <p className="rounded-lg bg-muted px-3 py-2 font-mono text-xl tracking-widest">{code.slice(-6).toUpperCase()}</p>
            <Button disabled={state === 'connecting'} onClick={() => void approve()}>Connect CLI</Button>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </>
        ) : <p className="text-sm text-muted-foreground">Open the approval link printed by the Zeko CLI.</p>}
      </section>
    </main>
  )
}
