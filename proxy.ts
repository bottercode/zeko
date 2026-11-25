import { createHash, timingSafeEqual } from 'node:crypto'
import { getToken } from 'next-auth/jwt'
import { NextResponse, type NextRequest } from 'next/server'
import { allowedGoogleEmail, canvasReturnPath, googleAuthConfigured } from '@/lib/auth-access'

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
  const { pathname, search } = request.nextUrl
  const read = request.method === 'GET' || request.method === 'HEAD'
  if (pathname === '/api/health' && request.method === 'GET') return NextResponse.next({ request: { headers } })

  if (!googleAuthConfigured() || pathname === '/api/mcp') {
    if (!basicAuthorized(request.headers.get('authorization'))) return basicChallenge()
    return NextResponse.next({ request: { headers } })
  }

  const publicOrigin = new URL(process.env.AUTH_URL!)
  const origin = headers.get('origin')
  if (!read && origin && origin !== publicOrigin.origin) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  if (
    pathname === '/login' ||
    pathname.startsWith('/api/auth/') ||
    (read && (pathname.startsWith('/_next/static/') || pathname === '/favicon.ico' || pathname === '/auth/google-sign-in.png'))
  ) {
    return NextResponse.next({ request: { headers } })
  }

  const token = await getToken({ req: { headers }, secret: process.env.AUTH_SECRET, secureCookie: true })
  if (!allowedGoogleEmail(token?.email)) {
    if (pathname === '/api' || pathname.startsWith('/api/') || !read) {
      return NextResponse.json({ error: 'Sign in to Zeko.' }, { status: 401 })
    }
    const login = new URL('/login', publicOrigin)
    const next = canvasReturnPath(pathname + search)
    if (next !== '/') login.searchParams.set('next', next)
    return NextResponse.redirect(login)
  }

  return NextResponse.next({ request: { headers } })
}
