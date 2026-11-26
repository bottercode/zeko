import 'server-only'

import { randomUUID } from 'node:crypto'
import { ndJsonStream } from '@agentclientprotocol/sdk'
import type { AcpAgentId } from '../acp'

export type RelayCommand =
  | { type: 'ready' }
  | { type: 'open'; id: string; agent: AcpAgentId; canvasTools: boolean }
  | { type: 'write'; id: string; bytes: string }
  | { type: 'close'; id: string }

type Session = {
  receive: (message: RelayInput) => void
  close: () => void
}
type Device = {
  id: string
  workspace: string
  agents: AcpAgentId[]
  send: (command: RelayCommand) => void
  sessions: Map<string, Session>
}
type RelayInput = { id: string; cwd?: string; bytes?: string; closed?: boolean }

const runtime = globalThis as typeof globalThis & {
  __zekoAcpDevices?: Map<string, Device>
  __zekoAcpDeviceListeners?: Map<string, Set<() => void>>
}
const devices = runtime.__zekoAcpDevices ??= new Map<string, Device>()
const listeners = runtime.__zekoAcpDeviceListeners ??= new Map<string, Set<() => void>>()
const key = (workspace: string, device: string) => `${workspace}:${device}`

function changed(workspace: string) {
  listeners.get(workspace)?.forEach((listener) => listener())
}

export function subscribeAcpDevices(workspace: string, listener: () => void) {
  const entries = listeners.get(workspace) ?? new Set()
  entries.add(listener)
  listeners.set(workspace, entries)
  return () => {
    entries.delete(listener)
    if (!entries.size) listeners.delete(workspace)
  }
}

export function registerAcpDevice(workspace: string, device: string, agents: AcpAgentId[], send: (command: RelayCommand) => void) {
  const id = key(workspace, device)
  const previous = devices.get(id)
  previous?.sessions.forEach((session) => session.close())
  const current: Device = { id: randomUUID(), workspace, agents, send, sessions: new Map() }
  devices.set(id, current)
  changed(workspace)
  return () => {
    current.sessions.forEach((session) => session.close())
    if (devices.get(id) !== current) return
    devices.delete(id)
    changed(workspace)
  }
}

export function acpDeviceStatus(workspace?: string) {
  const connected = workspace ? [...devices.values()].filter((device) => device.workspace === workspace) : []
  return { connected: connected.length > 0, agents: [...new Set(connected.flatMap((device) => device.agents))] }
}

export function acpDeviceFor(workspace: string, agent: AcpAgentId) {
  return [...devices.values()].find((device) => device.workspace === workspace && device.agents.includes(agent))
}

export function receiveAcpOutput(workspace: string, device: string, input: RelayInput) {
  const session = devices.get(key(workspace, device))?.sessions.get(input.id)
  if (!session) return false
  session.receive(input)
  return true
}

export async function openRelaySession(workspace: string, agent: AcpAgentId, canvasTools: boolean, signal: AbortSignal) {
  const device = acpDeviceFor(workspace, agent)
  if (!device) throw new Error('Start the Zeko CLI to connect this agent.')
  if (device.sessions.size >= 8) throw new Error('The Zeko CLI is busy. Try again shortly.')
  const id = randomUUID()
  let ready!: (cwd: string) => void
  let failed!: (error: Error) => void
  let output!: ReadableStreamDefaultController<Uint8Array>
  let closed = false
  let started = false
  const cwdPromise = new Promise<string>((resolve, reject) => { ready = resolve; failed = reject })
  const readable = new ReadableStream<Uint8Array>({ start: (controller) => { output = controller } })
  const writable = new WritableStream<Uint8Array>({
    write(bytes) {
      if (closed) throw new Error('The Zeko CLI disconnected.')
      device.send({ type: 'write', id, bytes: Buffer.from(bytes).toString('base64') })
    },
  })
  const close = () => {
    if (closed) return
    closed = true
    device.sessions.delete(id)
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    if (!started) failed(new Error('The Zeko CLI couldn’t start this agent.'))
    try { output.close() } catch {}
    device.send({ type: 'close', id })
  }
  const abort = () => {
    if (!started) close()
  }
  const timer = setTimeout(close, 12_000)
  signal.addEventListener('abort', abort, { once: true })
  device.sessions.set(id, {
    receive(message) {
      if (closed) return
      if (message.closed) { close(); return }
      if (!started && message.cwd) {
        started = true
        clearTimeout(timer)
        ready(message.cwd)
      } else if (started && message.bytes) {
        try { output.enqueue(Buffer.from(message.bytes, 'base64')) } catch { close() }
      }
    },
    close,
  })
  if (signal.aborted) close()
  else device.send({ type: 'open', id, agent, canvasTools })
  const cwd = await cwdPromise
  return { cwd, stream: ndJsonStream(writable, readable), close, launchFailed: () => false }
}
