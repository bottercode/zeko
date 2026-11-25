import { getBoard } from '@/lib/server/store'
import { canvasOf, noCanvas } from '@/lib/server/canvas'
import { framePdf, RenderUnavailable } from '@/lib/server/render'
import { withDesignTokens } from '@/lib/tokens'

export async function GET(req: Request, ctx: RouteContext<'/api/frames/[id]/pdf'>) {
  const { id } = await ctx.params
  const canvas = await canvasOf(req)
  if (!canvas) return noCanvas()
  const board = getBoard(canvas)
  const frame = board.frames.find((f) => f.id === id)
  if (!frame) return Response.json({ error: 'No such frame.' }, { status: 404 })
  if (frame.kind !== 'sketch' || frame.html === undefined) return Response.json({ error: 'Only sketches can be exported.' }, { status: 400 })
  try {
    const pdf = await framePdf(withDesignTokens(frame.html, board.design), frame.w, frame.h)
    const name = frame.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'frame'
    return new Response(new Uint8Array(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}.pdf"`, 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    const status = e instanceof RenderUnavailable ? 501 : 500
    return Response.json({ error: e instanceof Error ? e.message : 'Rendering failed.' }, { status })
  }
}
