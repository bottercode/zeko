#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { accessSync, constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createConnection, createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const CLI = fileURLToPath(import.meta.url)
const require = createRequire(import.meta.url)
const DEFAULT_URL = 'https://zeko-9e2z.onrender.com'
const HELP = `Usage:
  zeko [--url ${DEFAULT_URL}] [--pair]
  zeko status [--url ${DEFAULT_URL}] [--json]
  zeko stop [--url ${DEFAULT_URL}]
  zeko run [--url ${DEFAULT_URL}]
  zeko --version

Run zeko once, then approve the CLI in your Zeko workspace.
The CLI stays in the background and reconnects when the network returns.`
const digest = (value) => createHash('sha256').update(value).digest('hex')

function serverUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use the HTTPS address of your Zeko workspace.')
  }
  return url.origin
}

function locations(origin) {
  const id = digest(origin).slice(0, 24)
  const directory = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'zeko', 'acp')
  const socket = digest(homedir() + origin).slice(0, 20)
  return {
    directory,
    file: join(directory, `${id}.json`),
    socket: process.platform === 'win32' ? `\\\\.\\pipe\\zeko-acp-${socket}` : join(tmpdir(), `zeko-acp-${socket}.sock`),
  }
}

function openBrowser(link) {
  const [command, ...args] = process.platform === 'darwin' ? ['open'] :
    process.platform === 'win32' ? ['rundll32.exe', 'url.dll,FileProtocolHandler'] : ['xdg-open']
  const child = spawn(command, [...args, link], { stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

async function pair(origin, paths) {
  const secret = randomBytes(32).toString('hex')
  const code = digest(secret)
  const link = new URL('/connect/cli', origin)
  link.searchParams.set('code', code)
  console.log(`Approve this CLI in your browser. Code ${code.slice(-6).toUpperCase()}\n${link.href}`)
  openBrowser(link.href)
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    const response = await fetch(`${origin}/api/acp/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'error',
      body: JSON.stringify({ secret }),
      signal: AbortSignal.timeout(70_000),
    }).catch(() => undefined)
    if (response?.status === 200) {
      const { token } = await response.json()
      if (typeof token !== 'string' || !token) throw new Error('Zeko returned an invalid CLI credential.')
      await mkdir(paths.directory, { recursive: true, mode: 0o700 })
      const temporary = `${paths.file}.${randomBytes(8).toString('hex')}.tmp`
      try {
        await writeFile(temporary, JSON.stringify({ token, pairedAt: Date.now() }), { mode: 0o600, flag: 'wx' })
        await rename(temporary, paths.file)
      } finally { await unlink(temporary).catch(() => {}) }
      return token
    }
    if (response && response.status !== 202 && response.status < 500) throw new Error('This server doesn’t support Zeko CLI pairing.')
    await delay(1200)
  }
  throw new Error('CLI approval expired. Run zeko again.')
}

async function savedToken(paths) {
  try {
    const { token, pairedAt } = JSON.parse(await readFile(paths.file, 'utf8'))
    if (typeof token === 'string' && Date.now() - pairedAt < 29 * 24 * 60 * 60_000) return token
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function control(address, command) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(address)
    const reader = createInterface({ input: socket, crlfDelay: Infinity })
    reader.on('error', () => {})
    socket.setTimeout(1000, () => socket.destroy(new Error('Zeko CLI did not respond.')))
    socket.once('connect', () => socket.write(`${command}\n`))
    socket.once('error', (error) => {
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') resolve(null)
      else reject(error)
    })
    socket.once('close', () => resolve(null))
    reader.once('line', (line) => {
      try { resolve(JSON.parse(line)) } catch { reject(new Error('Invalid response from the Zeko CLI.')) }
      finally { socket.destroy() }
    })
  })
}

async function listen(server, address) {
  const open = () => new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(address, () => { server.off('error', reject); resolve() })
  })
  try {
    await open()
  } catch (error) {
    if (error.code !== 'EADDRINUSE' || process.platform === 'win32' || await control(address, 'status')) throw error
    const metadata = await lstat(address)
    if (!metadata.isSocket() || metadata.uid !== process.getuid()) throw error
    await unlink(address)
    await open()
  }
}

function executable(name) {
  const filename = process.platform === 'win32' ? `${name}.exe` : name
  for (const folder of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const file = join(folder, filename)
    try { accessSync(file, constants.X_OK); return file } catch {}
  }
}

function adapters() {
  const result = {}
  try { result.codex = require.resolve('@agentclientprotocol/codex-acp') } catch {}
  try { result.claude = join(dirname(require.resolve('@agentclientprotocol/claude-agent-acp/package.json')), 'dist', 'index.js') } catch {}
  return result
}

async function* events(body, touch) {
  const decoder = new TextDecoder()
  let pending = ''
  for await (const chunk of body) {
    touch()
    pending += decoder.decode(chunk, { stream: true })
    let boundary
    while ((boundary = pending.indexOf('\n\n')) >= 0) {
      const message = pending.slice(0, boundary)
      pending = pending.slice(boundary + 2)
      if (message.startsWith('data: ')) yield JSON.parse(message.slice(6))
    }
  }
}

async function relay(origin, token, stop, update) {
  const endpoint = new URL('/api/acp/relay', origin)
  const commands = adapters()
  endpoint.searchParams.set('agents', Object.keys(commands).join(','))
  const auth = { Authorization: `Bearer ${token}` }
  let backoff = 500
  while (!stop.aborted) {
    const attempt = new AbortController()
    const signal = AbortSignal.any([stop, attempt.signal])
    const sessions = new Map()
    let timeout
    const touch = () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => attempt.abort(), 75_000)
    }
    const post = async (input) => fetch(new URL('/api/acp/relay', origin), {
      method: 'POST',
      redirect: 'error',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    })
    const launch = async ({ id, agent, canvasTools }) => {
      const adapter = commands[agent]
      if (!adapter || sessions.has(id)) { await post({ id, closed: true }); return }
      const cwd = await mkdtemp(join(tmpdir(), 'zeko-acp-'))
      const codex = process.env.ZEKO_CODEX_PATH || executable('codex')
      const claude = process.env.ZEKO_CLAUDE_PATH || executable('claude')
      const child = spawn(process.execPath, [adapter], {
        cwd,
        stdio: ['pipe', 'pipe', 'ignore'],
        env: {
          ...process.env,
          ...(agent === 'codex' ? {
            ...(codex ? { CODEX_PATH: codex } : {}),
            INITIAL_AGENT_MODE: 'read-only',
            ...(canvasTools ? { DISABLE_MCP_CONFIG_FILTERING: 'true' } : {}),
            CODEX_CONFIG: JSON.stringify({
              sandbox_mode: 'read-only',
              features: { shell_tool: false, apps: false, hooks: false, plugins: false },
            }),
          } : claude ? { CLAUDE_CODE_EXECUTABLE: claude } : {}),
        },
      })
      child.stdin.on('error', () => {})
      sessions.set(id, child)
      let launchError = false
      child.on('error', () => { launchError = true })
      try {
        if (signal.aborted || !(await post({ id, cwd })).ok) return
        for await (const bytes of child.stdout) {
          if (signal.aborted || !(await post({ id, bytes: Buffer.from(bytes).toString('base64') })).ok) break
        }
      } finally {
        child.kill()
        sessions.delete(id)
        await rm(cwd, { recursive: true, force: true })
        if (!signal.aborted || launchError) await post({ id, closed: true }).catch(() => {})
      }
    }
    try {
      touch()
      const response = await fetch(endpoint, { headers: { ...auth, Accept: 'text/event-stream' }, redirect: 'error', signal })
      if (response.status === 401) {
        await response.body?.cancel()
        throw new Error('CLI approval has expired. Run zeko --pair to reconnect.')
      }
      if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
        await response.body?.cancel()
      } else for await (const message of events(response.body, touch)) {
        if (message.type === 'ready') {
          update(true)
          backoff = 500
        } else if (message.type === 'open') {
          void launch(message).catch(() => post({ id: message.id, closed: true }).catch(() => {}))
        } else if (message.type === 'write') {
          sessions.get(message.id)?.stdin.write(Buffer.from(message.bytes, 'base64'))
        } else if (message.type === 'close') {
          sessions.get(message.id)?.kill()
        }
      }
    } catch (error) {
      if (error.message?.startsWith('CLI approval has expired')) throw error
    } finally {
      attempt.abort()
      clearTimeout(timeout)
      for (const child of sessions.values()) child.kill()
      update(false)
    }
    if (!stop.aborted) await delay(backoff, undefined, { signal: stop }).catch(() => {})
    backoff = Math.min(backoff * 2, 8000)
  }
}

function display(state, json) {
  if (json) console.log(JSON.stringify(state))
  else if (!state.running) console.log('Zeko CLI is stopped.')
  else console.log(state.connected ? 'Zeko CLI connected.' : 'Zeko CLI is connecting…')
}

async function run(origin, paths, token, quiet) {
  process.umask(0o077)
  const stop = new AbortController()
  const status = { running: true, connected: false, url: origin }
  const server = createServer((socket) => {
    socket.on('error', () => {})
    socket.setTimeout(1000, () => socket.destroy())
    const reader = createInterface({ input: socket, crlfDelay: Infinity })
    reader.on('error', () => {})
    reader.once('line', (command) => {
      const stopping = command === 'stop'
      socket.end(`${JSON.stringify(stopping ? { ...status, running: false, connected: false } : status)}\n`)
      if (stopping) stop.abort()
    })
  })
  await listen(server, paths.socket)
  process.once('SIGINT', () => stop.abort())
  process.once('SIGTERM', () => stop.abort())
  if (!quiet) display(status, false)
  try {
    await relay(origin, token, stop.signal, (connected) => {
      if (status.connected === connected) return
      status.connected = connected
      if (!quiet && !stop.signal.aborted) display(status, false)
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { url: { type: 'string', default: DEFAULT_URL }, pair: { type: 'boolean' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } },
  })
  if (values.version) return console.log(JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8')).version)
  if (values.help) return console.log(HELP)
  const args = positionals[0] === 'agent' ? positionals.slice(1) : positionals
  const [action = 'start'] = args
  if (args.length > 1 || !['start', 'run', 'status', 'stop', 'worker'].includes(action)) throw new Error(HELP)
  const origin = serverUrl(values.url)
  const paths = locations(origin)
  const existing = await control(paths.socket, action === 'stop' || values.pair ? 'stop' : 'status')
  if (action === 'status' || action === 'stop') return display(existing ?? { running: false, connected: false, url: origin }, values.json)
  if (existing?.running) return display(existing, values.json)
  const token = (!values.pair && await savedToken(paths)) || (action !== 'worker' && await pair(origin, paths))
  if (!token) throw new Error('Run zeko to connect this device.')
  if (action === 'run' || action === 'worker') return run(origin, paths, token, action === 'worker')
  const child = spawn(process.execPath, [CLI, 'worker', '--url', origin], { detached: true, stdio: 'ignore' })
  child.unref()
  for (let i = 0; i < 24; i++) {
    await delay(125)
    const status = await control(paths.socket, 'status')
    if (status) return display(status, values.json)
  }
  throw new Error('Couldn’t start the Zeko CLI. Run zeko run to see the connection error.')
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
