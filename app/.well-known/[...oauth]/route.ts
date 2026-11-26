import { googleAuthConfigured, MCP_OAUTH_PATH, MCP_RESOURCE_METADATA, MCP_SERVER_METADATA } from '@/lib/auth-access'
import { issuer, resource } from '@/lib/server/mcp-oauth'

export function GET(request: Request) {
  if (!googleAuthConfigured()) return new Response(null, { status: 404 })
  const path = new URL(request.url).pathname
  const origin = issuer()
  const headers = { 'Cache-Control': 'public, max-age=300' }
  if (path === MCP_RESOURCE_METADATA || path === '/.well-known/oauth-protected-resource') {
    return Response.json({ resource: resource(), authorization_servers: [origin], scopes_supported: ['mcp'] }, { headers })
  }
  if (path !== MCP_SERVER_METADATA) return new Response(null, { status: 404 })
  const endpoint = origin + MCP_OAUTH_PATH
  return Response.json({
    issuer: origin,
    authorization_endpoint: endpoint + '/authorize',
    token_endpoint: endpoint + '/token',
    registration_endpoint: endpoint + '/register',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
    authorization_response_iss_parameter_supported: true,
  }, { headers })
}
