import 'server-only'
import { spawn } from 'node:child_process'
import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { client, ndJsonStream, PROTOCOL_VERSION, type SessionConfigOption, type SessionModeState, type SessionUpdate } from '@agentclientprotocol/sdk'
import { ACP_AGENTS, acpAgent, type AcpAgentId, type AcpCapabilities, type AcpOption, type AcpSettings } from '../acp'
import { acpDeviceStatus, openRelaySession } from './acp-relay'
import { currentWorkspace } from './store'

const CANVAS_TOOLS = [
  'get_board', 'get_frame', 'get_guide', 'get_guidelines', 'get_skill', 'claim_task', 'complete_task', 'set_status',
  'create_sketch', 'get_layers', 'edit_layers', 'edit_sketch', 'append_to_sketch', 'fit_frame_to_content', 'inspect_frame', 'screenshot_frame',
]

function executable(name: string) {
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const path = join(dir, name)
    try {
      accessSync(path, constants.X_OK)
      return path
    } catch {}
  }
}

function agentCommand(agent: typeof ACP_AGENTS[number]) {
  if (agent.bundled) return join(process.cwd(), 'node_modules', '.bin', agent.executable)
  return executable(agent.executable)
}

export function listAcpAgents(workspace = currentWorkspace()) {
  const remote = process.env.ZEKO_HOSTED === '1' ? acpDeviceStatus(workspace) : undefined
  return ACP_AGENTS.map((agent) => ({
    id: agent.id, name: agent.name, available: remote ? remote.agents.includes(agent.id) : !!agentCommand(agent),
  }))
}

function choicesFor(option: SessionConfigOption, id: AcpAgentId): AcpOption | undefined {
  const { id: optionId, name, category, description, currentValue } = option
  const info = { id: optionId, name, category, description }
  if (option.type === 'boolean') return { ...info, type: 'boolean', value: currentValue as boolean }
  const choices = option.options.flatMap((item) => 'options' in item ? item.options : [item])
    .map(({ value, name, description }) => ({
      value, name, description,
      ...(category === 'model' && (
        (id === 'claude' && value.startsWith('claude-')) || /\b(previous generation|legacy)\b/i.test(description || '')
      ) ? { more: true } : {}),
    }))
    .filter(({ value }) => category !== 'mode' || (id === 'claude' ? ['default', 'plan'].includes(value) : value === 'read-only'))
  if (choices.length < 2 && category === 'mode') return
  return { ...info, type: 'select', value: String(currentValue), choices }
}

export class AcpSessionError extends Error {}

function openLocalSession(agent: typeof ACP_AGENTS[number], canvasTools: boolean) {
  const command = agentCommand(agent)
  if (!command) throw new AcpSessionError('Install and sign in to this agent’s CLI first.')
  const { id } = agent
  const cwd = mkdtempSync(join(tmpdir(), 'zeko-acp-'))
  const claudePath = process.env.ZEKO_CLAUDE_PATH || executable('claude')
  const child = spawn(/* turbopackIgnore: true */ command, agent.args, {
    cwd,
    stdio: ['pipe', 'pipe', 'ignore'],
    env: {
      ...process.env,
      ...(id === 'codex' ? {
        CODEX_PATH: process.env.ZEKO_CODEX_PATH || executable('codex'),
        INITIAL_AGENT_MODE: 'read-only',
        // The session endpoint carries the run ID. It must take precedence over the external MCP entry.
        ...(canvasTools ? { DISABLE_MCP_CONFIG_FILTERING: 'true' } : {}),
        CODEX_CONFIG: JSON.stringify({
          sandbox_mode: 'read-only',
          features: { shell_tool: false, apps: false, hooks: false, plugins: false },
        }),
      } : {}),
      ...(id === 'claude' && claudePath ? { CLAUDE_CODE_EXECUTABLE: claudePath } : {}),
    },
  })
  let spawnError: Error | undefined
  child.once('error', (error) => { spawnError = error })
  child.stdin.on('error', () => { /* The connection reports process shutdown. */ })
  return {
    cwd,
    stream: ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>),
    launchFailed: () => !!spawnError,
    close: () => {
      child.kill()
      rmSync(cwd, { force: true, recursive: true })
    },
  }
}

export async function withAcpSession<T>(
  id: AcpAgentId,
  settings: AcpSettings,
  signal: AbortSignal,
  run: (session: {
    capabilities: () => AcpCapabilities
    prompt: (text: string) => Promise<{ stopReason: string }>
  }) => Promise<T>,
  options: { mcpUrl?: URL; mcpToken?: string; update?: (update: SessionUpdate) => void; onReady?: () => void } = {},
) {
  const agent = acpAgent(id)
  if (!agent) throw new AcpSessionError('Choose an ACP agent.')
  signal.throwIfAborted()
  const workspace = currentWorkspace()
  const transport = process.env.ZEKO_HOSTED === '1'
    ? await openRelaySession(workspace ?? '', id, !!options.mcpUrl, signal)
      .catch((error: Error) => { throw new AcpSessionError(error.message) })
    : openLocalSession(agent, !!options.mcpUrl)
  let config: SessionConfigOption[] = []
  let modes: SessionModeState | null | undefined
  let legacyModels: { currentModelId: string; availableModels: { modelId: string; name: string; description?: string | null }[] } | undefined
  let sessionId: string | undefined
  let canClose = false
  const canvasCalls = new Set<string>()
  const connection = client({ name: 'zeko' })
    .onRequest('session/request_permission', ({ params }) => {
      const allow = params.options.find((option) => option.kind === 'allow_once')
      if (allow && params.sessionId === sessionId && params._meta?.is_mcp_tool_approval === true && canvasCalls.has(params.toolCall.toolCallId)) {
        return { outcome: { outcome: 'selected', optionId: allow.optionId } }
      }
      return { outcome: { outcome: 'cancelled' } }
    })
    .onNotification('session/update', ({ params }) => {
      if (sessionId && params.sessionId !== sessionId) return
      const update = params.update
      if (options.mcpUrl && update.sessionUpdate === 'tool_call' && update._meta?.is_mcp_tool_call === true) {
        const input = update.rawInput as { server?: unknown; tool?: unknown } | null | undefined
        if (input?.server === 'zeko' && typeof input.tool === 'string' && CANVAS_TOOLS.includes(input.tool)) canvasCalls.add(update.toolCallId)
      }
      if (update.sessionUpdate === 'tool_call_update' && (update.status === 'completed' || update.status === 'failed')) canvasCalls.delete(update.toolCallId)
      if (update.sessionUpdate === 'config_option_update') config = update.configOptions
      options.update?.(update)
    })
    .connect(transport.stream)
  const peer = connection.agent
  const cancel = () => {
    if (!sessionId) { transport.close(); return }
    void peer.notify('session/cancel', { sessionId }).catch(() => {})
  }
  signal.addEventListener('abort', cancel, { once: true })
  const requestOptions = { cancellationSignal: signal, stopWaitingOnCancel: true }
  const capabilities = () => {
    const options = config.flatMap((option) => choicesFor(option, id) ?? [])
    if (!options.some((option) => option.category === 'model') && legacyModels?.availableModels?.length) {
      options.unshift({
        id: 'model', name: 'Model', category: 'model', type: 'select', value: legacyModels.currentModelId,
        choices: legacyModels.availableModels.map(({ modelId, name, description }) => ({ value: modelId, name, description })),
      })
    }
    if (id === 'claude' && !options.some((option) => option.category === 'mode') && modes?.availableModes?.length) {
      const choices = modes.availableModes.filter((mode) => ['default', 'plan'].includes(mode.id))
      if (choices.length > 1) options.push({
        id: 'mode', name: 'Mode', category: 'mode', type: 'select', value: modes.currentModeId,
        choices: choices.map(({ id, name, description }) => ({ value: id, name, description })),
      })
    }
    return { options }
  }
  try {
    const init = await peer.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'zeko', title: 'Zeko', version: '0.1.0' },
      clientCapabilities: { _meta: { 'agentclientprotocol.com': { session: { configOptions: { boolean: {} } } } } },
    }, requestOptions)
    if (init.protocolVersion !== PROTOCOL_VERSION) throw new AcpSessionError('This agent uses an unsupported ACP version.')
    canClose = !!init.agentCapabilities?.sessionCapabilities?.close
    if (options.mcpUrl && !init.agentCapabilities?.mcpCapabilities?.http) throw new AcpSessionError('This agent does not support Zeko’s HTTP canvas tools.')
    const session = await peer.request('session/new', {
      cwd: transport.cwd,
      mcpServers: options.mcpUrl ? [{
        name: 'zeko', type: 'http', url: options.mcpUrl.toString(),
        headers: options.mcpToken ? [{ name: 'Authorization', value: `Bearer ${options.mcpToken}` }] : [],
      }] : [],
      ...(id === 'claude' ? { _meta: { claudeCode: { options: {
        tools: [], persistSession: false, allowDangerouslySkipPermissions: false, settingSources: [],
        allowedTools: CANVAS_TOOLS.map((tool) => `mcp__zeko__${tool}`),
        extraArgs: { restricted: null },
      } } } } : {}),
    }, requestOptions)
    sessionId = session.sessionId
    config = session.configOptions ?? []
    modes = session.modes
    legacyModels = (session as { models?: typeof legacyModels }).models
    // Changing models can change the available thinking levels and other options.
    const modelId = capabilities().options.find((option) => option.category === 'model')?.id
    const requested = { ...settings }
    const mode = id === 'claude' ? capabilities().options.find((option) => option.category === 'mode') : undefined
    if (mode?.type === 'select' && !mode.choices.some((choice) => choice.value === requested[mode.id])) {
      requested[mode.id] = 'default'
    }
    const keys = Object.keys(requested).sort((a, b) => Number(b === modelId) - Number(a === modelId))
    for (const key of keys) {
      const option = capabilities().options.find(({ id }) => id === key)
      const value = requested[key]
      if (!option || value === option.value) continue
      const allowed = option.type === 'boolean' ? typeof value === 'boolean' : option.choices.some((choice) => choice.value === value)
      if (!allowed) continue
      if (!config.some((item) => item.id === key) && typeof value === 'string') {
        if (option.category === 'model' && legacyModels) {
          await peer.request('session/set_model', { sessionId, modelId: value }, requestOptions)
          legacyModels.currentModelId = value
        } else if (option.category === 'mode' && modes) {
          await peer.request('session/set_mode', { sessionId, modeId: value }, requestOptions)
          modes.currentModeId = value
        }
        continue
      }
      const response = await peer.request('session/set_config_option', {
        sessionId, configId: key, ...(typeof value === 'boolean' ? { type: 'boolean' as const, value } : { value }),
      }, requestOptions)
      config = response.configOptions
    }
    options.onReady?.()
    return await run({
      capabilities,
      prompt: (text) => peer.request('session/prompt', {
        sessionId: session.sessionId, prompt: [{ type: 'text', text }],
      }, requestOptions),
    })
  } catch (error) {
    if (signal.aborted || error instanceof AcpSessionError) throw error
    if (transport.launchFailed()) throw new AcpSessionError(`Couldn’t launch ${agent.name}.`)
    if (/auth|sign.in|login|credential/i.test(error instanceof Error ? error.message : '')) {
      throw new AcpSessionError(`Sign in to ${agent.name} in its CLI and try again.`)
    }
    throw new AcpSessionError(`${agent.name} couldn’t complete the ACP request. Check its CLI and try again.`)
  } finally {
    signal.removeEventListener('abort', cancel)
    if (sessionId && canClose && !signal.aborted) {
      await peer.request('session/close', { sessionId }, { cancellationSignal: AbortSignal.timeout(500), stopWaitingOnCancel: true }).catch(() => {})
    }
    connection.close()
    transport.close()
  }
}
