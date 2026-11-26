import { randomBytes } from 'node:crypto'
import { createServer, request as upstreamRequest } from 'node:http'

if (!process.env.ZEKO_PREVIEW_PASSWORD || !process.env.DATABASE_URL) {
  throw new Error('Set ZEKO_PREVIEW_PASSWORD and DATABASE_URL before starting the hosted preview.')
}

const publicPort = Number(process.env.PORT) || 10000
const internalPort = publicPort === 3000 ? 3001 : 3000
const gatewayToken = randomBytes(32).toString('hex')
const publicOrigin = process.env.AUTH_URL ? new URL(process.env.AUTH_URL) : undefined

const proxy = createServer((incoming, response) => {
  const { method, url } = incoming
  if (method !== 'GET' && method !== 'HEAD' && incoming.headers['sec-fetch-site'] === 'cross-site') {
    response.writeHead(403, { 'Cache-Control': 'no-store' }).end('Cross-site requests are unavailable.')
    return
  }

  const headers = { ...incoming.headers }
  delete headers['x-zeko-workspace']
  if (publicOrigin) {
    headers.host = publicOrigin.host
    headers['x-forwarded-host'] = publicOrigin.host
    headers['x-forwarded-proto'] = publicOrigin.protocol.slice(0, -1)
    headers['x-forwarded-port'] = publicOrigin.port || '443'
  }
  headers['x-zeko-preview-gateway'] = gatewayToken
  const upstream = upstreamRequest({ hostname: '127.0.0.1', port: internalPort, path: url, method, headers }, (result) => {
    const headers = { ...result.headers }
    const immutable = url?.startsWith('/_next/static/') &&
      (result.statusCode === 200 || result.statusCode === 304) &&
      headers['cache-control']?.includes('immutable') && !headers['set-cookie']
    if (!immutable) headers['cache-control'] = 'private, no-store, no-transform'
    response.writeHead(result.statusCode ?? 502, headers)
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
