import { encode } from 'next-auth/jwt'
import { ACP_TOKEN_SALT, googleAuthConfigured, workspaceId, WORKSPACE_HEADER } from '@/lib/auth-access'
import { approveCli, cliApproval } from '@/lib/server/acp-pairing'

export async function POST(request: Request) {
  if (!googleAuthConfigured()) return new Response(null, { status: 404 })
  const input = await request.json().catch(() => null)
  if (typeof input?.secret !== 'string' || !/^[a-f0-9]{64}$/.test(input.secret)) return new Response(null, { status: 400 })
  const approval = cliApproval(input.secret)
  if (!approval) return new Response(null, { status: 202 })
  const token = await encode({ token: approval, secret: process.env.AUTH_SECRET!, salt: ACP_TOKEN_SALT, maxAge: 30 * 24 * 60 * 60 })
  return Response.json({ token }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request) {
  if (!googleAuthConfigured()) return new Response(null, { status: 404 })
  const workspace = request.headers.get(WORKSPACE_HEADER)
  if (!workspaceId(workspace)) return new Response(null, { status: 401 })
  const input = await request.json().catch(() => null)
  if (!workspaceId(input?.code)) return Response.json({ error: 'Open the approval link from the Zeko CLI.' }, { status: 400 })
  if (!approveCli(input.code, workspace)) return Response.json({ error: 'Start a new connection from the Zeko CLI.' }, { status: 409 })
  return Response.json({ approved: true })
}
