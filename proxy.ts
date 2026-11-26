import { createHash, timingSafeEqual } from 'node:crypto'
import { decode, getToken } from 'next-auth/jwt'
import { NextResponse, type NextRequest } from 'next/server'
import { ACP_DEVICE_HEADER, ACP_RUN_TOKEN_SALT, ACP_TOKEN_SALT, canvasReturnPath, googleAuthConfigured, MCP_TOKEN_SALT, workspaceId, WORKSPACE_HEADER } from '@/lib/auth-access'

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
  headers.delete(ACP_DEVICE_HEADER)
  const { pathname, search } = request.nextUrl
  const read = request.method === 'GET' || request.method === 'HEAD'
  if (pathname === '/api/health' && request.method === 'GET') return NextResponse.next({ request: { headers } })

  if (!googleAuthConfigured()) {
    if (!basicAuthorized(request.headers.get('authorization'))) return basicChallenge()
    return NextResponse.next({ request: { headers } })
  }

  const publicOrigin = new URL(process.env.AUTH_URL!)
  const origin = headers.get('origin')
  if (!read && origin && origin !== publicOrigin.origin) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  if (pathname === '/api/acp/pair' && request.method === 'POST') return NextResponse.next({ request: { headers } })
  if (pathname === '/api/acp/relay') {
    const token = await bearerToken(request, ACP_TOKEN_SALT)
    if (!workspaceId(token?.workspace) || !workspaceId(token?.device)) return new NextResponse(null, { status: 401 })
    headers.set(WORKSPACE_HEADER, token.workspace)
    headers.set(ACP_DEVICE_HEADER, token.device)
    return NextResponse.next({ request: { headers } })
  }
  if (pathname === '/api/mcp' || pathname === '/api/agents/companion') {
    const auth = request.headers.get('authorization')
    if (pathname === '/api/mcp' && basicAuthorized(auth)) {
      headers.set(WORKSPACE_HEADER, 'legacy')
      return NextResponse.next({ request: { headers } })
    }
    const run = pathname === '/api/mcp' && request.nextUrl.searchParams.has('run')
    const token = await bearerToken(request, run ? ACP_RUN_TOKEN_SALT : MCP_TOKEN_SALT)
    if (!workspaceId(token?.workspace)) {
      return pathname === '/api/mcp'
        ? basicChallenge()
        : NextResponse.json({ error: 'Connect with a Zeko workspace token.' }, { status: 401 })
    }
    if (run && ['board', 'task', 'run', 'as'].some((field) => token[field] !== request.nextUrl.searchParams.get(field))) {
      return new NextResponse(null, { status: 401 })
    }
    headers.set(WORKSPACE_HEADER, token.workspace)
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
  if (!workspaceId(token?.workspace) || token.sub !== token.workspace) {
    if (pathname === '/api' || pathname.startsWith('/api/') || !read) {
      return NextResponse.json({ error: 'Sign in to Zeko.', code: 'sign_in_required' }, { status: 401 })
    }
    const login = new URL('/login', publicOrigin)
    const next = canvasReturnPath(pathname + search)
    if (next !== '/') login.searchParams.set('next', next)
    return NextResponse.redirect(login)
  }

  headers.set(WORKSPACE_HEADER, token.workspace)
  return NextResponse.next({ request: { headers } })
}

async function bearerToken(request: Request, salt: string) {
  const [, token] = /^Bearer ([A-Za-z0-9._-]{1,8192})$/i.exec(request.headers.get('authorization') ?? '') ?? []
  return token ? decode({ token, secret: process.env.AUTH_SECRET!, salt }).catch(() => null) : null
}
