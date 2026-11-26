import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCamera } from '../lib/client/camera'
import { alignMovingBox, boxAround } from '../lib/client/frame-snap'
import { designContext } from '../lib/design-brief'
import { emptyBoard } from '../lib/ops'
import type { Frame, Task } from '../lib/types'

test('camera pan leaves zoom listeners untouched and ignores identical updates', () => {
  const camera = createCamera()
  let moves = 0
  let zooms = 0
  const unsubscribe = camera.subscribe(() => { moves++ })
  camera.subscribeZoom(() => { zooms++ })
  camera.set((view) => ({ ...view, x: view.x + 10 }))
  camera.set({ ...camera.get() })
  assert.deepEqual([moves, zooms], [1, 0])
  unsubscribe()
  camera.set((view) => ({ ...view, z: view.z * 2 }))
  assert.deepEqual([moves, zooms], [1, 1])
})

test('alignment uses a screen-pixel threshold and a common offset for the selection', () => {
  const selection = boxAround([{ x: 0, y: 10, w: 40, h: 40 }, { x: 60, y: 12, w: 40, h: 38 }])
  assert.deepEqual(selection, { x: 0, y: 10, w: 100, h: 40 })
  const neighbor = { x: 108, y: 150, w: 40, h: 60 }
  assert.deepEqual(alignMovingBox(selection, [neighbor], 1), { dx: 0, dy: 0, guides: [] })
  assert.deepEqual(alignMovingBox(selection, [neighbor], 0.5), {
    dx: 8, dy: 0, guides: [{ axis: 'x', at: 108, from: 10, to: 210 }],
  })
})

test('the agent snapshot prioritizes attachments and pinned references across pages', () => {
  const board = emptyBoard()
  board.pages = [{ id: 'one', name: 'Overview' }, { id: 'two', name: 'Checkout' }]
  board.guidelines = 'x'.repeat(3300)
  const common = { x: 0, y: 0, w: 390, h: 844, createdAt: 0, updatedAt: 0, createdBy: { kind: 'human', name: 'Designer' } } as const
  const target: Frame = { ...common, id: 'cart', name: 'Cart', kind: 'sketch', pageId: 'two' }
  board.frames = [
    target,
    { ...common, id: 'guide', name: 'Style reference', kind: 'website', url: 'https://example.com/style', reference: true, pageId: 'one' },
    { ...common, id: 'other', name: 'Onboarding', kind: 'sketch', pageId: 'one' },
  ]
  const task: Task = {
    id: 'request', text: 'Refine the cart', frameIds: [target.id], pageId: target.pageId,
    at: 1, updatedAt: 1, status: 'open', author: common.createdBy,
  }
  const context = designContext(board, task)
  assert.equal(context.page.id, 'two')
  assert.equal(context.attachments[0]?.id, 'cart')
  assert.equal(context.references[0]?.url, 'https://example.com/style')
  assert.deepEqual(context.otherFrames, [])
  assert.equal(context.guidelines.length, 3200)
  assert.equal(context.more, true)
})
