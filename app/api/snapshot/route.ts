import { z } from 'zod'
import { withWorkspace } from '@/lib/server/store'
import { canvasOf, noCanvas } from '@/lib/server/canvas'
import { RenderUnavailable } from '@/lib/server/render'
import { BlockedAddress } from '@/lib/server/safe-url'
import { snapshotPage } from '@/lib/server/snapshot'

const body = z.object({
  url: z.string().trim().min(1).max(2048),
  width: z.number().int().min(320).max(2560).default(1280),
  height: z.number().int().min(320).max(4000).default(800),
})

/** Capture a live page as editable sketch HTML. */
async function handlePost(request: Request) {
  if (!(await canvasOf(request))) return noCanvas()
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Enter the page address to capture.' }, { status: 400 })
  try {
    const { url, width, height } = parsed.data
    return Response.json(await snapshotPage(url, width, height))
  } catch (error) {
    const status = error instanceof BlockedAddress ? 400 : error instanceof RenderUnavailable ? 501 : 502
    return Response.json({ error: error instanceof Error ? error.message : 'Couldn’t capture that page.' }, { status })
  }
}

export const POST = withWorkspace(handlePost)
