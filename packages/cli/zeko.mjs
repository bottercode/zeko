#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createInterface as createPrompt } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'

const CLI = fileURLToPath(import.meta.url)
const exec = promisify(execFile)
const DEFAULT_URL = 'http://localhost:4747'
const HOSTED_URL = 'https://zeko-9e2z.onrender.com'
const HELP = `Usage:
  zeko connect [--provider codex|claude] [--url ${HOSTED_URL}] [--board ID]
  zeko launch [--provider codex|claude] [--url ${HOSTED_URL}] [--board ID] [-- AGENT_ARGS]
  zeko agent [start|run|status|stop] [--provider codex|claude] [--url ${DEFAULT_URL}] [--json]
  zeko --version

Copy a workspace token from Zeko's MCP connection dialog to connect a hosted workspace.
The agent command manages a background companion for local or hosted Zeko.`

function serverUrl(value) {
  const url = new URL(value)
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.port
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an HTTPS Zeko address or the HTTP address of your local Zeko server.')
  }
  if (local) url.hostname = '127.0.0.1'
  return url.origin
}

const hosted = (origin) => origin.startsWith('https:')

function settingsFile(origin, provider) {
  const key = createHash('sha256').update(origin).update('\0').update(provider).digest('hex').slice(0, 24)
  const directory = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'zeko', 'connections')
  return { directory, file: join(directory, `${key}.json`) }
}

async function savedConnection(origin, provider) {
  if (!hosted(origin)) return {}
  try {
    return JSON.parse(await readFile(settingsFile(origin, provider).file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Run zeko connect for this workspace first.')
    throw error
  }
}

async function workspaceToken() {
  if (process.env.ZEKO_MCP_TOKEN) return process.env.ZEKO_MCP_TOKEN.trim()
  if (!process.stdin.isTTY) throw new Error('Open Zeko’s MCP connection dialog, then run zeko connect in a terminal to paste the token.')
  const mutedOutput = new Writable({ write(_chunk, _encoding, done) { done() } })
  const input = createPrompt({ input: process.stdin, output: mutedOutput, terminal: true })
  process.stderr.write('Paste the workspace token and press Enter. ')
  try {
    return (await input.question('')).trim()
  } finally {
    input.close()
    process.stderr.write('\n')
  }
}

function companionRequest(origin, provider, token, signal) {
  return fetch(`${origin}/api/agents/companion?provider=${provider}`, {
    signal,
    redirect: 'error',
    headers: { Accept: 'text/event-stream', ...(token && { Authorization: `Bearer ${token}` }) },
  })
}

async function connect(origin, provider, board) {
  if (!hosted(origin)) throw new Error('Run zeko agent start to connect to local Zeko.')
  const token = await workspaceToken()
  if (!/^[\w.-]{20,4096}$/.test(token)) throw new Error('Copy a workspace token from Zeko’s MCP connection dialog.')
  const response = await companionRequest(origin, provider, token, AbortSignal.timeout(75_000))
  await response.body?.cancel()
  if (response.status === 401) throw new Error('The workspace token has expired or is invalid. Copy a new token in Zeko.')
  if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
    throw new Error('Could not connect to this Zeko workspace. Check the address and try again.')
  }
  const { directory, file } = settingsFile(origin, provider)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify({ token, board }), { flag: 'wx', mode: 0o600 })
    await rename(temporary, file)
  } finally {
    await unlink(temporary).catch(() => {})
  }
  console.log(`Workspace connected. Start your agent with zeko launch --provider ${provider} --url ${origin}`)
}

function controlAddress(origin, provider) {
  const hash = createHash('sha256').update(homedir()).update(origin)
  if (provider !== 'codex') hash.update(provider)
  const key = hash.digest('hex').slice(0, 18)
  return process.platform === 'win32' ? `\\\\.\\pipe\\zeko-${key}` : join(tmpdir(), `zeko-${key}.sock`)
}

function control(address, command) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(address)
    const input = createInterface({ input: socket, crlfDelay: Infinity })
    input.on('error', () => { /* The socket's error handler reports the cause. */ })
    socket.setTimeout(1_000, () => socket.destroy(new Error('Zeko companion did not respond.')))
    socket.once('connect', () => socket.write(`${command}\n`))
    socket.once('error', (error) => {
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') resolve(null)
      else reject(error)
    })
    socket.once('close', () => resolve(null))
    input.once('line', (line) => {
      try { resolve(JSON.parse(line)) } catch { reject(new Error('Invalid reply from the Zeko companion.')) }
      finally { socket.destroy() }
    })
  })
}

function listen(server, address) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(address, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

async function openControl(server, address) {
  try {
    await listen(server, address)
  } catch (error) {
    if (error.code !== 'EADDRINUSE' || await control(address, 'status')) throw error
    if (process.platform === 'win32') throw error
    const file = await lstat(address)
    if (!file.isSocket() || file.uid !== process.getuid()) throw error
    await unlink(address)
    await listen(server, address)
  }
}

async function checkProvider(provider, name) {
  try {
    if (provider === 'codex') {
      await exec(executable(provider), ['login', 'status'], { timeout: 8_000 })
    } else {
      const { stdout } = await exec(executable(provider), ['auth', 'status', '--json'], { timeout: 8_000 })
      if (!JSON.parse(stdout).loggedIn) throw new Error('Claude is signed out.')
    }
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Install the ${name} CLI first.`)
    throw new Error(`Sign in with ${provider === 'codex' ? 'codex login' : 'claude auth login'}, then start the companion again.`)
  }
}

function executable(provider) {
  return provider === 'codex' ? process.env.ZEKO_CODEX_PATH || 'codex' : process.env.ZEKO_CLAUDE_PATH || 'claude'
}

async function keepConnected(origin, provider, signal, update) {
  let retry = 1_000
  while (!signal.aborted) {
    const connection = new AbortController()
    const lifetime = AbortSignal.any([signal, connection.signal])
    let watchdog
    const refresh = () => {
      clearTimeout(watchdog)
      watchdog = setTimeout(() => connection.abort(), 45_000)
    }
    refresh()
    try {
      const { token } = await savedConnection(origin, provider)
      const response = await companionRequest(origin, provider, token, lifetime)
      if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
        await response.body?.cancel()
        throw new Error('Zeko companion endpoint is unavailable.')
      }
      for await (const _event of response.body) {
        update(true)
        retry = 1_000
        refresh()
      }
    } catch {
      // The same companion reconnects after a disconnect or app restart.
    } finally {
      clearTimeout(watchdog)
      update(false)
    }
    if (signal.aborted) break
    await delay(retry, undefined, { signal }).catch(() => {})
    retry = Math.min(retry * 2, 8_000)
  }
}

function display(state, json) {
  if (json) console.log(JSON.stringify(state))
  else if (!state.running) console.log('Zeko companion is stopped.')
  else if (state.connected) console.log(`${state.agent} connected to ${state.url}.`)
  else console.log(`Zeko companion is running. Waiting for Zeko at ${state.url}.`)
}

async function run(origin, address, provider, name, quiet, json = false) {
  process.umask(0o077)
  const stop = new AbortController()
  const status = { running: true, connected: false, agent: name, url: origin }
  const server = createServer((socket) => {
    socket.on('error', () => {})
    socket.setTimeout(1_000, () => socket.destroy())
    const input = createInterface({ input: socket, crlfDelay: Infinity })
    input.on('error', () => {})
    input.once('line', (command) => {
      const stopping = command === 'stop'
      socket.end(`${JSON.stringify(stopping ? { ...status, running: false, connected: false } : status)}\n`)
      if (stopping) stop.abort()
    })
  })
  await openControl(server, address)
  process.once('SIGINT', () => stop.abort())
  process.once('SIGTERM', () => stop.abort())
  if (!quiet) display(status, json)
  try {
    await keepConnected(origin, provider, stop.signal, (connected) => {
      if (status.connected === connected) return
      status.connected = connected
      if (!quiet && !stop.signal.aborted) display(status, json)
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

async function startCompanion(origin, address, provider) {
  const existing = await control(address, 'status')
  if (existing) return existing
  const child = spawn(process.execPath, [CLI, 'agent', 'worker', '--url', origin, '--provider', provider], {
    detached: true, stdio: 'ignore',
  })
  child.unref()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(100)
    const status = await control(address, 'status')
    if (status) return status
  }
  throw new Error('Could not start the Zeko companion. Run zeko agent run to see the startup error.')
}

async function launch(origin, provider, name, boardOverride, args) {
  const { token, board } = await savedConnection(origin, provider)
  await checkProvider(provider, name)
  await startCompanion(origin, controlAddress(origin, provider), provider)
  const url = new URL('/api/mcp', origin)
  url.searchParams.set('as', name)
  if (boardOverride ?? board) url.searchParams.set('board', boardOverride ?? board)
  const config = provider === 'codex'
    ? ['-c', `mcp_servers.zeko={url=${JSON.stringify(url.href)}, startup_timeout_sec=60${token ? ', bearer_token_env_var="ZEKO_MCP_TOKEN"' : ''}}`]
    : ['--mcp-config', JSON.stringify({ mcpServers: { zeko: { type: 'http', url: url.href, ...(token && { headers: { Authorization: 'Bearer ${ZEKO_MCP_TOKEN}' } }) } } })]
  const child = spawn(executable(provider), provider === 'codex' ? [...config, ...args] : [...args, ...config], {
    stdio: 'inherit',
    env: { ...process.env, ...(token && { ZEKO_MCP_TOKEN: token }) },
  })
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 1)))
  })
}

async function main() {
  const argv = process.argv.slice(2)
  const separator = argv.indexOf('--')
  const args = separator === -1 ? [] : argv.slice(separator + 1)
  const { values, positionals } = parseArgs({
    args: separator === -1 ? argv : argv.slice(0, separator),
    allowPositionals: true,
    options: { url: { type: 'string' }, provider: { type: 'string', default: 'codex' }, board: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } },
  })
  if (values.version) return console.log(JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8')).version)
  if (values.help || !positionals.length) return console.log(HELP)
  const [group, action = 'start'] = positionals
  if (!['agent', 'connect', 'launch'].includes(group) || (group !== 'agent' && positionals.length !== 1) || (group !== 'launch' && args.length)) throw new Error(HELP)
  const origin = serverUrl(values.url ?? (group === 'agent' ? DEFAULT_URL : HOSTED_URL))
  const provider = values.provider
  if (provider !== 'codex' && provider !== 'claude') throw new Error('Choose --provider codex or --provider claude.')
  const name = provider === 'claude' ? 'Claude' : 'Codex'
  if (values.board && !/^[\w-]{1,40}$/.test(values.board)) throw new Error('Use the canvas ID shown in Zeko.')
  if (group === 'connect') return connect(origin, provider, values.board)
  if (group === 'launch') return launch(origin, provider, name, values.board, args)
  if (positionals.length > 2 || !['start', 'run', 'status', 'stop', 'worker'].includes(action)) throw new Error(HELP)
  const address = controlAddress(origin, provider)
  const stopped = { running: false, connected: false, agent: name, url: origin }
  if (action === 'worker') return run(origin, address, provider, name, true)
  if (action === 'status' || action === 'stop') return display(await control(address, action) ?? stopped, values.json)
  const existing = await control(address, 'status')
  if (existing) return display(existing, values.json)
  await savedConnection(origin, provider)
  await checkProvider(provider, name)
  if (action === 'run') return run(origin, address, provider, name, false, values.json)
  display(await startCompanion(origin, address, provider), values.json)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
