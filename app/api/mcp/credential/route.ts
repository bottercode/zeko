import { encode } from 'next-auth/jwt'
import { googleAuthConfigured, MCP_TOKEN_SALT } from '@/lib/auth-access'
import { requestMember } from '@/lib/server/teams'

export async function POST(request: Request) {
  if (!googleAuthConfigured()) return new Response(null, { status: 404 })
  const member = await requestMember(request.headers)
  if (!member) return Response.json({ error: 'Sign in to Zeko.' }, { status: 401 })
  const token = await encode({
    token: { workspace: member.team, user: member.user },
    secret: process.env.AUTH_SECRET!,
    salt: MCP_TOKEN_SALT,
    maxAge: 30 * 24 * 60 * 60,
  })
  return Response.json({ token }, { headers: { 'Cache-Control': 'no-store' } })
}
