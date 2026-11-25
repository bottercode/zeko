import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, request as upstreamRequest } from 'node:http'

const password = process.env.ZEKO_PREVIEW_PASSWORD
if (!password || !process.env.DATABASE_URL) {
  throw new Error('Set ZEKO_PREVIEW_PASSWORD and DATABASE_URL before starting the hosted preview.')
}

const publicPort = Number(process.env.PORT) || 10000
const internalPort = publicPort === 3000 ? 3001 : 3000
const expected = hash(`zeko:${password}`)
const gatewayToken = randomBytes(32).toString('hex')

function hash(value) {
  return createHash('sha256').update(value).digest()
}

function authorized(header) {
  const [, token] = /^Basic ([A-Za-z0-9+/=]+)$/i.exec(header ?? '') ?? []
  return !!token && timingSafeEqual(hash(Buffer.from(token, 'base64')), expected)
}

const proxy = createServer((incoming, response) => {
  const { method, url } = incoming
  const checkingHealth = method === 'GET' && url === '/api/health'
  if (!checkingHealth && !authorized(incoming.headers.authorization)) {
    response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Zeko preview", charset="UTF-8"', 'Cache-Control': 'no-store' })
    response.end('Sign in to the Zeko preview.')
    return
  }
  if (method !== 'GET' && method !== 'HEAD' && incoming.headers['sec-fetch-site'] === 'cross-site') {
    response.writeHead(403, { 'Cache-Control': 'no-store' }).end('Cross-site requests are unavailable.')
    return
  }

  const headers = { ...incoming.headers }
  delete headers.authorization
  headers['x-zeko-preview-gateway'] = gatewayToken
  const upstream = upstreamRequest({ hostname: '127.0.0.1', port: internalPort, path: url, method, headers }, (result) => {
    response.writeHead(result.statusCode ?? 502, { ...result.headers, 'Cache-Control': 'private, no-store' })
    result.pipe(response)
  })
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(503, { 'Cache-Control': 'no-store' }).end('Zeko is starting.')
    else response.destroy()
  })
  response.on('close', () => upstream.destroy())
  incoming.pipe(upstream)
})

process.env.HOSTNAME = '127.0.0.1'
process.env.PORT = String(internalPort)
process.env.ZEKO_PREVIEW_GATEWAY_TOKEN = gatewayToken
await import('./server.js')
proxy.listen(publicPort, '0.0.0.0')
