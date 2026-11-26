import { googleAuthConfigured } from '@/lib/auth-access'
import { exchangeMcpToken, registerMcpClient, requestMcpConsent } from '@/lib/server/mcp-oauth'

export async function GET(request: Request, { params }: RouteContext<'/api/mcp/oauth/[action]'>) {
  if (googleAuthConfigured() && (await params).action === 'authorize') return requestMcpConsent(request)
  return new Response(null, { status: 404 })
}

export async function POST(request: Request, { params }: RouteContext<'/api/mcp/oauth/[action]'>) {
  if (!googleAuthConfigured()) return new Response(null, { status: 404 })
  const { action } = await params
  if (action === 'register') return registerMcpClient(request)
  if (action === 'token') return exchangeMcpToken(request)
  return new Response(null, { status: 404 })
}
