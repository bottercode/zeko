export const ACP_AGENTS = /** @type {const} */ ([
  { id: 'codex', name: 'Codex', executable: 'codex-acp', args: [], bundled: true },
  { id: 'claude', name: 'Claude', executable: 'claude-agent-acp', args: [], bundled: true },
  { id: 'cursor', name: 'Cursor', executable: 'agent', args: ['acp'], bundled: false },
  { id: 'gemini', name: 'Gemini CLI', executable: 'gemini', args: ['--acp'], bundled: false },
  { id: 'copilot', name: 'GitHub Copilot', executable: 'copilot', args: ['--acp'], bundled: false },
  { id: 'opencode', name: 'OpenCode', executable: 'opencode', args: ['acp'], bundled: false },
  { id: 'kimi', name: 'Kimi Code', executable: 'kimi', args: ['acp'], bundled: false },
  { id: 'vibe', name: 'Mistral Vibe', executable: 'vibe-acp', args: [], bundled: false },
])
