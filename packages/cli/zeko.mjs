#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, unlink } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'

const CLI = fileURLToPath(import.meta.url)
const exec = promisify(execFile)
const DEFAULT_URL = 'http://localhost:4747'
const HELP = 'Usage: zeko agent [start|run|status|stop] [--provider codex|claude] [--url http://localhost:4747] [--json]'

function serverUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use the HTTP address of your local Zeko server.')
  }
  url.hostname = '127.0.0.1'
  return url.origin
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
      await exec(process.env.ZEKO_CODEX_PATH || 'codex', ['login', 'status'], { timeout: 8_000 })
    } else {
      const { stdout } = await exec(process.env.ZEKO_CLAUDE_PATH || 'claude', ['auth', 'status', '--json'], { timeout: 8_000 })
      if (!JSON.parse(stdout).loggedIn) throw new Error('Claude is signed out.')
    }
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Install the ${name} CLI first.`)
    throw new Error(`Sign in with ${provider === 'codex' ? 'codex login' : 'claude auth login'}, then start the companion again.`)
  }
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
      const response = await fetch(`${origin}/api/agents/companion?provider=${provider}`, { signal: lifetime, headers: { Accept: 'text/event-stream' } })
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

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { url: { type: 'string', default: DEFAULT_URL }, provider: { type: 'string', default: 'codex' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
  })
  if (values.help || !positionals.length) return console.log(HELP)
  const [group, action = 'start'] = positionals
  if (group !== 'agent' || positionals.length > 2 || !['start', 'run', 'status', 'stop', 'worker'].includes(action)) throw new Error(HELP)
  const origin = serverUrl(values.url)
  const provider = values.provider
  if (provider !== 'codex' && provider !== 'claude') throw new Error('Choose --provider codex or --provider claude.')
  const name = provider === 'claude' ? 'Claude' : 'Codex'
  const address = controlAddress(origin, provider)
  const stopped = { running: false, connected: false, agent: name, url: origin }
  if (action === 'worker') return run(origin, address, provider, name, true)
  if (action === 'status' || action === 'stop') return display(await control(address, action) ?? stopped, values.json)
  const existing = await control(address, 'status')
  if (existing) return display(existing, values.json)
  await checkProvider(provider, name)
  if (action === 'run') return run(origin, address, provider, name, false, values.json)
  const child = spawn(process.execPath, [CLI, 'agent', 'worker', '--url', origin, '--provider', provider], { detached: true, stdio: 'ignore' })
  child.unref()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(100)
    const state = await control(address, 'status')
    if (state) return display(state, values.json)
  }
  throw new Error('Could not start the Zeko companion. Run zeko agent run to see the startup error.')
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
