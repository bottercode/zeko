import 'server-only'

import { createHash } from 'node:crypto'

type Pairing = { workspace: string; expiresAt: number }
const runtime = globalThis as typeof globalThis & { __zekoAcpPairings?: Map<string, Pairing> }
const pairings = runtime.__zekoAcpPairings ??= new Map<string, Pairing>()

export function approveCli(code: string, workspace: string) {
  const now = Date.now()
  for (const [key, entry] of pairings) if (entry.expiresAt <= now) pairings.delete(key)
  if (pairings.has(code)) return pairings.get(code)?.workspace === workspace
  if (pairings.size >= 500) return false
  pairings.set(code, { workspace, expiresAt: now + 5 * 60_000 })
  return true
}

export function cliApproval(secret: string) {
  const code = createHash('sha256').update(secret).digest('hex')
  const entry = pairings.get(code)
  if (!entry || entry.expiresAt <= Date.now()) return
  return { workspace: entry.workspace, device: code }
}
