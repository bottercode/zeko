import 'server-only'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/*
 * Addresses the server may fetch on someone's behalf. On a hosted Zeko, only public internet addresses: never
 * the server's own network. A personal Zeko on someone's machine may also reach localhost, such as their dev server.
 */

const hosted = () => process.env.ZEKO_HOSTED === '1'

function privateV4(ip: string) {
  const [a, b] = ip.split('.').map(Number) as [number, number]
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
}

function privateV6(ip: string) {
  const lower = ip.toLowerCase()
  if (lower.startsWith('::ffff:')) return privateV4(lower.slice(7))
  return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')
}

export const privateAddress = (ip: string) => (isIP(ip) === 6 ? privateV6(ip) : privateV4(ip))

export class BlockedAddress extends Error {}

/** Throws unless the URL is http(s) and, on a hosted Zeko, every address its host resolves to is public. */
export async function assertFetchable(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new BlockedAddress('Enter a full http:// or https:// address.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedAddress('Only http:// and https:// addresses can be loaded.')
  if (url.username || url.password) throw new BlockedAddress('Addresses with credentials can’t be loaded.')
  if (!hosted()) return url
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((entry) => entry.address)
  if (!addresses.length) throw new BlockedAddress(`Couldn’t find ${url.hostname}.`)
  if (addresses.some(privateAddress)) throw new BlockedAddress('That address is on a private network.')
  return url
}
