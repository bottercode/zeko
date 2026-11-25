export const WORKSPACE_HEADER = 'x-zeko-workspace'
export const MCP_TOKEN_SALT = 'zeko-mcp-v1'

export function googleAuthConfigured() {
  return Boolean(
    process.env.ZEKO_HOSTED === '1' &&
    process.env.AUTH_URL &&
    process.env.AUTH_SECRET &&
    process.env.AUTH_GOOGLE_ID &&
    process.env.AUTH_GOOGLE_SECRET
  )
}

export function workspaceId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

export function canvasReturnPath(value: unknown) {
  const base = 'https://zeko.invalid'
  if (typeof value !== 'string' || !value.startsWith('/') || /[\\\s]/.test(value) || value.length > 2048) return '/'
  try {
    const url = new URL(value, base)
    return url.origin === base && /^\/(?:c\/[\w-]+)?$/.test(url.pathname) ? url.pathname + url.search : '/'
  } catch {
    return '/'
  }
}
