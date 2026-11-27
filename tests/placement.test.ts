import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyOp, emptyBoard, placeFrame, ROW_MAX_WIDTH } from '../lib/ops'
import type { Actor, Board } from '../lib/types'

const agent: Actor = { kind: 'agent', name: 'Claude' }
const W = 1440
const H = 900

/** Adds frames the way an agent does: each placed where placeFrame says. */
function add(board: Board, id: string, route?: string, state?: string, w = W, h = H) {
  const spot = placeFrame(board, 'page-1', { w, h, route })
  return applyOp(board, { type: 'frame.create', frame: { id, kind: 'sketch', name: id, html: '<body></body>', w, h, route, state, ...spot } }, agent)
}
const at = (board: Board, id: string) => { const f = board.frames.find((x) => x.id === id)!; return { x: f.x, y: f.y } }
const overlaps = (board: Board) => board.frames.some((a, i) => board.frames.slice(i + 1).some((b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y))

test('each screen gets a row, and its states line up beside it', () => {
  let board = emptyBoard()
  board = add(board, 'home', '/')
  board = add(board, 'note', '/note')
  board = add(board, 'search', '/search')
  board = add(board, 'home-empty', '/', 'empty')
  board = add(board, 'note-offline', '/note', 'error')
  board = add(board, 'home-loading', '/', 'loading')
  assert.deepEqual(at(board, 'home'), { x: 0, y: 0 })
  const rows = ['home', 'note', 'search'].map((id) => at(board, id).y)
  assert.ok(rows[0]! < rows[1]! && rows[1]! < rows[2]!, 'new screens go below')
  assert.equal(at(board, 'home-empty').y, 0)
  assert.equal(at(board, 'home-loading').y, 0)
  assert.ok(at(board, 'home-loading').x > at(board, 'home-empty').x)
  assert.equal(at(board, 'note-offline').y, at(board, 'note').y)
  assert.equal(at(board, 'note').x, 0)
  assert.ok(!overlaps(board))
})

test('frames without a route fill the last row, then wrap', () => {
  let board = emptyBoard()
  for (let i = 0; i < 8; i++) board = add(board, `f${i}`)
  const ys = [...new Set(board.frames.map((f) => f.y))]
  assert.ok(ys.length >= 2, 'a long run of frames wraps into rows')
  for (const y of ys) {
    const row = board.frames.filter((f) => f.y === y)
    assert.ok(Math.max(...row.map((f) => f.x + f.w)) - Math.min(...row.map((f) => f.x)) <= ROW_MAX_WIDTH)
  }
  assert.ok(!overlaps(board))
})

test('a state never lands on a frame someone moved into its way', () => {
  let board = add(add(emptyBoard(), 'home', '/'), 'note', '/note')
  // Someone drags the note screen up beside home.
  board = applyOp(board, { type: 'frame.update', id: 'note', patch: { x: W + 96, y: 0 } }, agent)
  board = add(board, 'home-empty', '/', 'empty')
  assert.ok(!overlaps(board))
})
