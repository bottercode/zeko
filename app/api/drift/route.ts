import { z } from 'zod'
import { dispatch, flushCanvas, getBoard, withWorkspace } from '@/lib/server/store'
import { canvasOf, noCanvas } from '@/lib/server/canvas'
import { RenderUnavailable } from '@/lib/server/render'
import { BlockedAddress } from '@/lib/server/safe-url'
import { captureBuild } from '@/lib/server/drift'

const body = z.object({
  designId: z.string().min(1).optional(),
  buildId: z.string().min(1).optional(),
  url: z.string().trim().max(2048).optional(),
  recapture: z.boolean().optional(),
}).refine((value) => value.designId || value.buildId)

/** Capture the implemented page for a design (or capture a build again) and check how it drifts from the design. */
async function handlePost(request: Request) {
  const id = await canvasOf(request)
  if (!id) return noCanvas()
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Choose a design frame or a build to check.' }, { status: 400 })
  const person = { kind: 'human' as const, name: 'You' }
  try {
    const { build, drift } = await captureBuild({ board: () => getBoard(id), apply: (op) => { dispatch(id, op, person) } }, parsed.data)
    await flushCanvas(id)
    return Response.json({ buildId: build.id, drift })
  } catch (error) {
    const status = error instanceof BlockedAddress ? 400 : error instanceof RenderUnavailable ? 501 : 422
    const message = error instanceof BlockedAddress && process.env.ZEKO_HOSTED === '1'
      ? 'Hosted Zeko can’t reach addresses on your computer or private network. Capture a deployed preview or staging URL, or run Zeko locally to check a localhost build.'
      : error instanceof Error ? error.message : 'Couldn’t check that build.'
    return Response.json({ error: message }, { status })
  }
}

export const POST = withWorkspace(handlePost)
