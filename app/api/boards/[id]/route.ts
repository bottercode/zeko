import { createBoard, deleteBoard, dispatch, getBoard, hasBoard } from '@/lib/server/store'

/** Rename: { name }. Duplicate: { duplicate: true }, which answers with the copy's id. */
export async function PATCH(request: Request, ctx: RouteContext<'/api/boards/[id]'>) {
  const { id } = await ctx.params
  if (!hasBoard(id)) return Response.json({ error: 'No such canvas.' }, { status: 404 })
  const body = ((await request.json().catch(() => null)) ?? {}) as { name?: string; duplicate?: boolean }
  if (body.duplicate) {
    const board = getBoard(id)
    return Response.json({ id: createBoard({ name: `${board.name} copy`, from: structuredClone(board) }) }, { status: 201 })
  }
  const name = body.name?.trim().slice(0, 80)
  if (!name) return Response.json({ error: 'A name is required.' }, { status: 400 })
  dispatch(id, { type: 'board.update', name }, { kind: 'human', name: 'You' })
  return Response.json({ id })
}

/** Moves the canvas to .zeko/trash. */
export async function DELETE(_request: Request, ctx: RouteContext<'/api/boards/[id]'>) {
  const { id } = await ctx.params
  return deleteBoard(id) ? new Response(null, { status: 204 }) : Response.json({ error: 'No such canvas.' }, { status: 404 })
}
