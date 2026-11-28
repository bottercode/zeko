import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, lt } from 'drizzle-orm'
import { decode, encode } from 'next-auth/jwt'
import { z } from 'zod'
import { googleAuthConfigured, MCP_OAUTH_TOKEN_SALT, MCP_PATH } from '../auth-access'
import { teamRole } from './teams'
import { workspaceDatabase } from '../db/connection'
import { mcpOAuthGrants } from '../db/schema'

const CLIENT_SALT = 'zeko-mcp-oauth-client-v1'
const CONSENT_SALT = 'zeko-mcp-oauth-consent-v1'
const ACCESS_SECONDS = 3600
const REFRESH_MS = 30 * 24 * 3600_000
const CODE_MS = 120_000
const SCOPE = 'mcp'
const NO_STORE = { 'Cache-Control': 'no-store' }
const codePattern = /^[\w-]{43}$/
const verifierPattern = /^[A-Za-z0-9._~-]{43,128}$/
const digest = (value: string) => createHash('sha256').update(value)
const hash = (value: string) => digest(value).digest('hex')
const grantToken = () => randomBytes(32).toString('base64url')
const secret = () => process.env.AUTH_SECRET!
export const issuer = () => new URL(process.env.AUTH_URL!).origin
export const resource = () => issuer() + MCP_PATH

function loopback(url: URL) {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}

function redirectUrl(value: string) {
  if (value.length > 256 || /[\\\s]/.test(value)) return
  try {
    const url = new URL(value)
    if (url.username || url.password || url.hash || ['code', 'state', 'error', 'iss'].some((key) => url.searchParams.has(key))) return
    if (url.protocol === 'https:' || (loopback(url) && url.port)) return url
    if (url.protocol === 'cursor:' && url.host === 'anysphere.cursor-mcp' && url.pathname === '/oauth/callback') return url
  } catch { return }
}

function sameRedirect(registered: string, requested: string) {
  if (registered === requested) return true
  // Native clients can select a new port on their registered loopback callback.
  const a = redirectUrl(registered)
  const b = redirectUrl(requested)
  if (!a || !b || !loopback(a) || !loopback(b)) return false
  a.port = ''
  b.port = ''
  return a.href === b.href
}

const clientSchema = z.object({
  redirect_uris: z.array(z.string().refine((value) => !!redirectUrl(value))).min(1).max(4),
  client_name: z.string().max(160).optional(),
  token_endpoint_auth_method: z.literal('none').optional(),
})
const clientClaims = z.object({ redirects: clientSchema.shape.redirect_uris, agent: z.string().max(40) })
const consentClaims = z.object({
  clientHash: z.string().regex(/^[a-f0-9]{64}$/),
  redirectUri: z.string().refine((value) => !!redirectUrl(value)),
  challenge: z.string().regex(codePattern),
  state: z.string().max(512).optional(),
  agent: z.string().max(40),
})

function agentName(name?: string) {
  if (/claude/i.test(name ?? '')) return 'Claude'
  if (/codex/i.test(name ?? '')) return 'Codex'
  if (/cursor/i.test(name ?? '')) return 'Cursor'
  return 'Agent'
}

function oauthError(error: string, status = 400) {
  return Response.json({ error }, { status, headers: NO_STORE })
}

async function requestText(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) return ''
  let size = 0
  const decoder = new TextDecoder()
  let body = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) return body + decoder.decode()
    size += value.byteLength
    if (size > 16_384) {
      await reader.cancel()
      throw new Error('OAuth request is too large')
    }
    body += decoder.decode(value, { stream: true })
  }
}

async function readClient(id: string | null) {
  if (!id || id.length > 2400) return
  const claims = await decode({ salt: CLIENT_SALT, secret: secret(), token: id }).catch(() => null)
  const client = clientClaims.safeParse(claims)
  if (client.success) return { ...client.data, hash: hash(id) }
}

export async function registerMcpClient(request: Request) {
  const input = await requestText(request).then((text) => JSON.parse(text)).catch(() => null)
  const client = clientSchema.safeParse(input)
  if (!client.success) return oauthError('invalid_client_metadata')
  // The encrypted ID carries public registration metadata without storing unapproved clients.
  const clientId = await encode({
    secret: secret(), salt: CLIENT_SALT, maxAge: 10 * 365 * 86400,
    token: { redirects: client.data.redirect_uris, agent: agentName(client.data.client_name) },
  })
  return Response.json({
    ...client.data,
    client_id: clientId,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  }, { status: 201, headers: NO_STORE })
}

function matchesResource(params: URLSearchParams) {
  const values = params.getAll('resource')
  // Older clients can omit the indicator. This server issues access for a single resource.
  return values.length === 0 || (values.length === 1 && values[0] === resource())
}

export async function requestMcpConsent(request: Request) {
  const params = new URL(request.url).searchParams
  const client = await readClient(params.get('client_id'))
  const redirectUri = params.get('redirect_uri')
  if (!client || !redirectUri || !client.redirects.some((registered) => sameRedirect(registered, redirectUri))) return oauthError('invalid_request')
  if (!matchesResource(params)) return oauthError('invalid_target')
  if (params.get('scope') && params.get('scope') !== SCOPE) return oauthError('invalid_scope')
  if (params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256') return oauthError('invalid_request')
  const input = consentClaims.safeParse({
    clientHash: client.hash,
    redirectUri,
    challenge: params.get('code_challenge'),
    state: params.get('state') ?? undefined,
    agent: client.agent,
  })
  if (!input.success) return oauthError('invalid_request')
  const next = new URL('/connect/mcp', issuer())
  next.searchParams.set('request', await encode({ token: input.data, secret: secret(), salt: CONSENT_SALT, maxAge: 600 }))
  return new Response(null, { status: 302, headers: { ...NO_STORE, Location: next.href } })
}

export async function mcpConsent(token: unknown) {
  if (!googleAuthConfigured() || typeof token !== 'string' || token.length > 1900) return
  const claims = await decode({ salt: CONSENT_SALT, secret: secret(), token }).catch(() => null)
  const consent = consentClaims.safeParse(claims)
  if (consent.success) return consent.data
}

export async function finishMcpConsent(consent: z.infer<typeof consentClaims>, member: { team: string; user: string }, approved: boolean) {
  const next = new URL(consent.redirectUri)
  if (consent.state) next.searchParams.set('state', consent.state)
  next.searchParams.set('iss', issuer())
  if (!approved) {
    next.searchParams.set('error', 'access_denied')
    return next.href
  }

  const code = grantToken()
  const db = workspaceDatabase()
  await db.transaction(async (tx) => {
    await tx.delete(mcpOAuthGrants).where(lt(mcpOAuthGrants.expiresAt, new Date()))
    await tx.insert(mcpOAuthGrants).values({
      tokenHash: hash(code), userId: member.user, teamId: member.team, clientHash: consent.clientHash,
      kind: 'code', challenge: consent.challenge, redirectUri: consent.redirectUri,
      expiresAt: new Date(Date.now() + CODE_MS),
    })
  })
  next.searchParams.set('code', code)
  return next.href
}

export async function exchangeMcpToken(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded')) return oauthError('invalid_request')
  const body = await requestText(request).catch(() => null)
  if (!body) return oauthError('invalid_request')
  const params = new URLSearchParams(body)
  if (!matchesResource(params)) return oauthError('invalid_target')
  const client = await readClient(params.get('client_id'))
  if (!client) return oauthError('invalid_client', 401)
  const grant = params.get('grant_type')
  if (grant !== 'authorization_code' && grant !== 'refresh_token') return oauthError('unsupported_grant_type')
  const isCode = grant === 'authorization_code'
  const presented = params.get(isCode ? 'code' : 'refresh_token')
  if (!presented || !codePattern.test(presented)) return oauthError('invalid_grant')
  const redirectUri = params.get('redirect_uri')
  const verifier = params.get('code_verifier')
  if (isCode && (!redirectUri || !verifier || !verifierPattern.test(verifier))) return oauthError('invalid_grant')
  const refreshToken = grantToken()
  const result = await workspaceDatabase().transaction(async (tx) => {
    const [record] = await tx.delete(mcpOAuthGrants).where(and(
      eq(mcpOAuthGrants.tokenHash, hash(presented)),
      eq(mcpOAuthGrants.clientHash, client.hash),
      eq(mcpOAuthGrants.kind, isCode ? 'code' : 'refresh'),
      gt(mcpOAuthGrants.expiresAt, new Date()),
      isCode ? eq(mcpOAuthGrants.redirectUri, redirectUri!) : undefined,
      isCode ? eq(mcpOAuthGrants.challenge, digest(verifier!).digest('base64url')) : undefined,
    )).returning({ user: mcpOAuthGrants.userId, team: mcpOAuthGrants.teamId })
    if (!record) return
    // Grants from before teams were for the person's own workspace, which became their personal team.
    const team = record.team ?? record.user
    // Someone who left the team can't refresh access to it.
    if (!await teamRole(record.user, team)) return
    await tx.insert(mcpOAuthGrants).values({
      tokenHash: hash(refreshToken), userId: record.user, teamId: team, clientHash: client.hash,
      kind: 'refresh', expiresAt: new Date(Date.now() + REFRESH_MS),
    })
    return encode({
      secret: secret(), salt: MCP_OAUTH_TOKEN_SALT, maxAge: ACCESS_SECONDS,
      token: { workspace: team, user: record.user, aud: resource(), agent: client.agent },
    })
  })
  if (!result) return oauthError('invalid_grant')
  return Response.json({
    access_token: result,
    token_type: 'Bearer',
    expires_in: ACCESS_SECONDS,
    refresh_token: refreshToken,
    scope: SCOPE,
  }, { headers: { ...NO_STORE, Pragma: 'no-cache' } })
}
