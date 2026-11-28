import { createHash, timingSafeEqual } from 'node:crypto'
import { decode, getToken } from 'next-auth/jwt'
import { NextResponse, type NextRequest } from 'next/server'
import { ACP_DEVICE_HEADER, ACP_RUN_TOKEN_SALT, ACP_TOKEN_SALT, canvasReturnPath, googleAuthConfigured, MCP_AGENT_HEADER, MCP_OAUTH_PATH, MCP_OAUTH_TOKEN_SALT, MCP_PATH, MCP_RESOURCE_METADATA, MCP_SERVER_METADATA, MCP_TOKEN_SALT, USER_HEADER, workspaceId, WORKSPACE_HEADER } from '@/lib/auth-access'

function basicAuthorized(header: string | null) {
  const password = process.env.ZEKO_PREVIEW_PASSWORD
  const [, token] = /^Basic ([A-Za-z0-9+/=]+)$/i.exec(header ?? '') ?? []
  if (!password || !token) return false
  const digest = (value: string | Buffer) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(Buffer.from(token, 'base64')), digest(`zeko:${password}`))
}

function basicChallenge() {
  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Zeko", charset="UTF-8"' },
  })
}

export async function proxy(request: NextRequest) {
  if (process.env.ZEKO_HOSTED !== '1') return NextResponse.next()

  const expected = process.env.ZEKO_PREVIEW_GATEWAY_TOKEN
  const supplied = request.headers.get('x-zeko-preview-gateway')
  const gatewayToken = Buffer.from(supplied ?? '')
  if (!expected || gatewayToken.byteLength !== expected.length || !timingSafeEqual(gatewayToken, Buffer.from(expected))) {
    return new NextResponse('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }

  const headers = new Headers(request.headers)
  headers.delete('x-zeko-preview-gateway')
  headers.delete('authorization')
  headers.delete(WORKSPACE_HEADER)
  headers.delete(USER_HEADER)
  headers.delete(ACP_DEVICE_HEADER)
  headers.delete(MCP_AGENT_HEADER)
  const { pathname, search } = request.nextUrl
  const read = request.method === 'GET' || request.method === 'HEAD'
  if (pathname === '/api/health' && request.method === 'GET') return NextResponse.next({ request: { headers } })

  if (!googleAuthConfigured()) {
    if (!basicAuthorized(request.headers.get('authorization'))) return basicChallenge()
    return NextResponse.next({ request: { headers } })
  }

  const publicOrigin = new URL(process.env.AUTH_URL!)
  if (read && [MCP_RESOURCE_METADATA, MCP_SERVER_METADATA, '/.well-known/oauth-protected-resource'].includes(pathname)) {
    return NextResponse.next({ request: { headers } })
  }
  const origin = headers.get('origin')
  if (!read && origin && origin !== publicOrigin.origin) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  if ((read && pathname === MCP_OAUTH_PATH + '/authorize') ||
      (request.method === 'POST' && [MCP_OAUTH_PATH + '/register', MCP_OAUTH_PATH + '/token'].includes(pathname))) {
    return NextResponse.next({ request: { headers } })
  }
  if (pathname === '/api/acp/pair' && request.method === 'POST') return NextResponse.next({ request: { headers } })
  if (pathname === '/api/acp/relay') {
    const token = await bearerToken(request, ACP_TOKEN_SALT)
    if (!workspaceId(token?.workspace) || !workspaceId(token?.device)) return new NextResponse(null, { status: 401 })
    headers.set(WORKSPACE_HEADER, token.workspace)
    headers.set(USER_HEADER, tokenUser(token))
    headers.set(ACP_DEVICE_HEADER, token.device)
    return NextResponse.next({ request: { headers } })
  }
  if (pathname === MCP_PATH || pathname === '/api/agents/companion') {
    const auth = request.headers.get('authorization')
    if (pathname === '/api/mcp' && basicAuthorized(auth)) {
      headers.set(WORKSPACE_HEADER, 'legacy')
      return NextResponse.next({ request: { headers } })
    }
    const run = pathname === MCP_PATH && request.nextUrl.searchParams.has('run')
    if (pathname === MCP_PATH && !run) {
      const oauth = await bearerToken(request, MCP_OAUTH_TOKEN_SALT)
      if (oauth?.aud === publicOrigin.origin + MCP_PATH && workspaceId(oauth.workspace)) {
        headers.set(WORKSPACE_HEADER, oauth.workspace)
        headers.set(USER_HEADER, tokenUser(oauth))
        if (typeof oauth.agent === 'string') headers.set(MCP_AGENT_HEADER, oauth.agent)
        return NextResponse.next({ request: { headers } })
      }
    }
    const token = await bearerToken(request, run ? ACP_RUN_TOKEN_SALT : MCP_TOKEN_SALT)
    if (!workspaceId(token?.workspace)) {
      return pathname === MCP_PATH
        ? new NextResponse('Sign in to Zeko to connect.', { status: 401, headers: {
          'WWW-Authenticate': `Bearer resource_metadata="${publicOrigin.origin}${MCP_RESOURCE_METADATA}", scope="mcp"`,
          'Cache-Control': 'no-store',
        } })
        : NextResponse.json({ error: 'Connect with a Zeko workspace token.' }, { status: 401 })
    }
    if (run && ['board', 'task', 'run', 'as'].some((field) => token[field] !== request.nextUrl.searchParams.get(field))) {
      return new NextResponse(null, { status: 401 })
    }
    headers.set(WORKSPACE_HEADER, token.workspace)
    headers.set(USER_HEADER, tokenUser(token))
    return NextResponse.next({ request: { headers } })
  }
  if (
    pathname === '/login' ||
    pathname.startsWith('/api/auth/') ||
    (read && (pathname.startsWith('/_next/static/') || pathname === '/favicon.ico' || pathname === '/auth/google-sign-in.png'))
  ) {
    return NextResponse.next({ request: { headers } })
  }

  const token = await getToken({ req: { headers }, secret: process.env.AUTH_SECRET, secureCookie: true })
  // sub is the person and workspace the team they have open; sessions from before teams carry the same ID in both.
  if (!workspaceId(token?.workspace) || !workspaceId(token.sub)) {
    if (pathname === '/api' || pathname.startsWith('/api/') || !read) {
      return NextResponse.json({ error: 'Sign in to Zeko.', code: 'sign_in_required' }, { status: 401 })
    }
    const login = new URL('/login', publicOrigin)
    const next = canvasReturnPath(pathname + search)
    if (next !== '/') login.searchParams.set('next', next)
    return NextResponse.redirect(login)
  }

  headers.set(WORKSPACE_HEADER, token.workspace)
  headers.set(USER_HEADER, token.sub)
  return NextResponse.next({ request: { headers } })
}

/** The person an agent token acts for. Tokens issued before teams name only the workspace, which was the person's own. */
function tokenUser(token: Record<string, unknown>) {
  return workspaceId(token.user) ? token.user : token.workspace as string
}

async function bearerToken(request: Request, salt: string) {
  const [, token] = /^Bearer ([A-Za-z0-9._-]{1,8192})$/i.exec(request.headers.get('authorization') ?? '') ?? []
  return token ? decode({ token, secret: process.env.AUTH_SECRET!, salt }).catch(() => null) : null
}
