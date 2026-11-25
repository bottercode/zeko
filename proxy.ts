import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  if (process.env.ZEKO_HOSTED !== '1') return NextResponse.next()

  const expected = process.env.ZEKO_PREVIEW_GATEWAY_TOKEN
  const supplied = request.headers.get('x-zeko-preview-gateway')
  const token = Buffer.from(supplied ?? '')
  if (!expected || token.byteLength !== expected.length || !timingSafeEqual(token, Buffer.from(expected))) {
    return new NextResponse('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }

  const headers = new Headers(request.headers)
  headers.delete('x-zeko-preview-gateway')
  return NextResponse.next({ request: { headers } })
}
