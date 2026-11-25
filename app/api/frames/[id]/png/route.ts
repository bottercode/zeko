import type { NextRequest } from 'next/server'
import { getBoard, withWorkspace } from '@/lib/server/store'
import { canvasOf, noCanvas } from '@/lib/server/canvas'
import { RenderUnavailable, screenshot } from '@/lib/server/render'
import { withDesignTokens } from '@/lib/tokens'

/** A sketch as a PNG: ?scale=1|2|3, &full=1 for the whole page rather than the frame's size. */
async function handleGet(req: NextRequest, ctx: RouteContext<'/api/frames/[id]/png'>) {
  const { id } = await ctx.params
  const canvas = await canvasOf(req)
  if (!canvas) return noCanvas()
  const board = getBoard(canvas)
  const frame = board.frames.find((f) => f.id === id)
  if (!frame) return Response.json({ error: 'No such frame.' }, { status: 404 })
  if (frame.kind !== 'sketch' || frame.html === undefined) return Response.json({ error: 'Only sketches can be exported.' }, { status: 400 })
  const scale = Number(req.nextUrl.searchParams.get('scale') ?? 2) || 2
  const full = req.nextUrl.searchParams.get('full') === '1'
  try {
    const png = await screenshot(withDesignTokens(frame.html, board.design), { width: frame.w, height: frame.h, scale, fullPage: full })
    const name = `${frame.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'frame'}@${scale}x.png`
    return new Response(new Uint8Array(png), {
      headers: { 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    const status = e instanceof RenderUnavailable ? 501 : 500
    return Response.json({ error: e instanceof Error ? e.message : 'Rendering failed.' }, { status })
  }
}

export const GET = withWorkspace(handleGet)
