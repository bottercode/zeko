import 'server-only'

import { lookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, type TcpNetConnectOpts } from 'node:net'
import { parse as parseYaml } from 'yaml'
import { SKILL_DESCRIPTION_LIMIT, SKILL_TEXT_LIMIT, SKILL_TITLE_LIMIT, skillSourceUrl } from '../canvas-skills'
import type { CanvasSkill } from '../types'

export class SkillImportError extends Error {}

const MAX_BYTES = 128 * 1024
const privateV4 = new BlockList()
for (const [subnet, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) privateV4.addSubnet(subnet, prefix, 'ipv4')

const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
const reservedV6 = new BlockList()
for (const [subnet, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) {
  reservedV6.addSubnet(subnet, prefix, 'ipv6')
}

async function publicAddresses(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = await lookup(host, { all: true })
  const allowed = addresses.filter(({ address, family }) => family === 4
    ? !privateV4.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !reservedV6.check(address, 'ipv6'))
  const first = allowed[0]
  if (first) return { first, allowed }
  throw new SkillImportError('Use a public URL for the skill file.')
}

function githubRaw(url: URL) {
  if (url.hostname !== 'github.com') return url
  const [owner, repo, mode, ...path] = url.pathname.split('/').filter(Boolean)
  if (!owner || !repo) return url
  if (mode === 'blob' && path.length >= 2) return new URL(`https://raw.githubusercontent.com/${owner}/${repo}/${path.join('/')}`)
  if (mode === 'tree' && path.length >= 1) return new URL(`https://raw.githubusercontent.com/${owner}/${repo}/${path.join('/')}/SKILL.md`)
  if (!mode) return new URL(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/SKILL.md`)
  return url
}

async function download(firstUrl: URL) {
  let url = firstUrl
  const signal = AbortSignal.timeout(8000)

  for (let redirects = 0; redirects <= 4; redirects++) {
    const { first, allowed } = await publicAddresses(url)
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest
    const options: RequestOptions & Pick<TcpNetConnectOpts, 'autoSelectFamily'> = {
      agent: false,
      autoSelectFamily: true,
      // Connect only to addresses that passed the public IP check.
      lookup: (_name, options, callback) => {
        if (options.all) callback(null, allowed)
        else callback(null, first.address, first.family)
      },
      headers: { Accept: 'text/markdown, text/plain, application/octet-stream', 'Accept-Encoding': 'identity' },
      signal,
    }
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const outgoing = request(url, options, resolve)
      outgoing.on('error', reject)
      outgoing.end()
    })
    const status = response.statusCode ?? 500
    if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
      response.destroy()
      const location = skillSourceUrl(new URL(response.headers.location, url).href)
      if (!location) throw new SkillImportError('The link redirected to an unsupported URL.')
      url = location
      continue
    }

    const mime = response.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
    if (status < 200 || status >= 300) {
      response.destroy()
      throw new SkillImportError(`The skill file returned HTTP ${status}.`)
    }
    if (mime && !['text/plain', 'text/markdown', 'text/x-markdown', 'application/markdown', 'application/octet-stream'].includes(mime)) {
      response.destroy()
      throw new SkillImportError('Use a link to a Markdown or plain-text skill file.')
    }

    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of response) {
      const buffer = Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_BYTES) throw new SkillImportError('The skill file is too large.')
      chunks.push(buffer)
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
  }
  throw new SkillImportError('The skill link redirects too many times.')
}

export async function importSkill(value: string): Promise<Omit<CanvasSkill, 'id'>> {
  const source = skillSourceUrl(value.trim())
  if (!source) throw new SkillImportError('Enter an HTTP or HTTPS URL for the skill file.')
  const file = (await download(githubRaw(source))).trim()
  if (/^<(?:!doctype|html|head|body)\b/i.test(file)) throw new SkillImportError('Use a link to the raw Markdown file.')

  const front = /^(?:---[^\S\r\n]*\r?\n)([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)/.exec(file)
  let metadata: { name?: unknown; description?: unknown } | undefined
  if (front) {
    try {
      const parsed: unknown = parseYaml(front[1]!, { maxAliasCount: 0, version: '1.2' })
      if (parsed && typeof parsed === 'object') metadata = parsed
    } catch {
      throw new SkillImportError('The skill file has invalid YAML metadata.')
    }
  }
  const text = (front ? file.slice(front[0].length) : file).trim()
  if (!text) throw new SkillImportError('The skill file has no instructions.')
  if (text.length > SKILL_TEXT_LIMIT) throw new SkillImportError('Use a skill with at most 24,000 characters of instructions.')

  const heading = /^#\s+(.+)$/m.exec(text)?.[1]
  const name = typeof metadata?.name === 'string' ? metadata.name.trim() : undefined
  const description = typeof metadata?.description === 'string' ? metadata.description.trim() : ''
  return {
    title: (name || heading || 'Imported skill').slice(0, SKILL_TITLE_LIMIT),
    description: description.slice(0, SKILL_DESCRIPTION_LIMIT),
    text,
    sourceUrl: source.href,
  }
}
