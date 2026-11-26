import { ACP_AGENTS } from '../packages/cli/agents.mjs'

export { ACP_AGENTS }

export type AcpAgentId = typeof ACP_AGENTS[number]['id']
export type AcpSettings = Record<string, string | boolean>
export type AcpSelection = { agent: AcpAgentId; settings: AcpSettings }
export type AcpChoice = { value: string; name: string; description?: string | null; more?: boolean }
export type AcpOption = {
  id: string
  name: string
  category?: string | null
  description?: string | null
} & (
  | { type: 'select'; value: string; choices: AcpChoice[] }
  | { type: 'boolean'; value: boolean }
)
export type AcpAgentStatus = { id: AcpAgentId; name: string; available: boolean }
export type AcpCapabilities = { options: AcpOption[] }
export type AcpToolActivity = { id: string; title: string; status: 'pending' | 'in_progress' | 'completed' | 'failed' }

export const acpAgent = (id: string | undefined) => ACP_AGENTS.find((agent) => agent.id === id)

export function readAcpSelection(value: unknown): AcpSelection | undefined {
  if (!value || typeof value !== 'object') return
  const input = value as { agent?: string; settings?: unknown }
  const agent = acpAgent(input.agent)
  if (!agent || !input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings)) return
  const entries = Object.entries(input.settings)
  if (entries.length > 20 || entries.some(([id, setting]) => !/^[\w.-]{1,80}$/.test(id) || (typeof setting !== 'boolean' && (typeof setting !== 'string' || setting.length > 180)))) return
  return { agent: agent.id, settings: Object.fromEntries(entries) as AcpSettings }
}
