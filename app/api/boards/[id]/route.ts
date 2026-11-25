import { createBoard, deleteBoard, dispatch, flushCanvas, getBoard, hasBoard, prepareStore, withWorkspace } from '@/lib/server/store'

/** Rename: { name }. Duplicate: { duplicate: true }, which answers with the copy's id. */
async function handlePatch(request: Request, ctx: RouteContext<'/api/boards/[id]'>) {
  const { id } = await ctx.params
  await prepareStore()
  if (!hasBoard(id)) return Response.json({ error: 'No such canvas.' }, { status: 404 })
  const body = ((await request.json().catch(() => null)) ?? {}) as { name?: string; duplicate?: boolean }
  if (body.duplicate) {
    const board = getBoard(id)
    const copy = createBoard({ name: `${board.name} copy`, from: board })
    await flushCanvas(copy)
    return Response.json({ id: copy }, { status: 201 })
  }
  const name = body.name?.trim().slice(0, 80)
  if (!name) return Response.json({ error: 'A name is required.' }, { status: 400 })
  dispatch(id, { type: 'board.update', name }, { kind: 'human', name: 'You' })
  await flushCanvas(id)
  return Response.json({ id })
}

/** Archives the canvas in the active storage backend. */
async function handleDelete(_request: Request, ctx: RouteContext<'/api/boards/[id]'>) {
  const { id } = await ctx.params
  await prepareStore()
  if (!deleteBoard(id)) return Response.json({ error: 'No such canvas.' }, { status: 404 })
  await flushCanvas(id)
  return new Response(null, { status: 204 })
}

export const PATCH = withWorkspace(handlePatch)
export const DELETE = withWorkspace(handleDelete)
