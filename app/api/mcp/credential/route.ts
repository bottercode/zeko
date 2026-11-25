import { encode } from 'next-auth/jwt'
import { googleAuthConfigured, MCP_TOKEN_SALT, workspaceId, WORKSPACE_HEADER } from '@/lib/auth-access'

export async function POST(request: Request) {
  if (!googleAuthConfigured()) return new Response(null, { status: 404 })
  const workspace = request.headers.get(WORKSPACE_HEADER)
  if (!workspaceId(workspace)) return Response.json({ error: 'Sign in to Zeko.' }, { status: 401 })
  const token = await encode({
    token: { workspace },
    secret: process.env.AUTH_SECRET!,
    salt: MCP_TOKEN_SALT,
    maxAge: 30 * 24 * 60 * 60,
  })
  return Response.json({ token }, { headers: { 'Cache-Control': 'no-store' } })
}
