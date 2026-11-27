import assert from 'node:assert/strict'
import { test } from 'node:test'
import { alternatesRequest, alternateTree, generations } from '../lib/alternates'
import { applyOp, emptyBoard } from '../lib/ops'
import { linksOf, missingStateRequest, stateMap } from '../lib/state-map'
import type { Actor, Board, Frame } from '../lib/types'

const person: Actor = { kind: 'human', name: 'Designer' }
const sketch = (id: string, props: Partial<Frame> = {}) => ({
  type: 'frame.create' as const,
  frame: { id, kind: 'sketch' as const, name: id, html: '<body></body>', x: 0, y: 0, w: 400, h: 300, ...props },
})
const build = (ops: Parameters<typeof applyOp>[1][]) => ops.reduce<Board>((board, op) => applyOp(board, op, person), emptyBoard())

test('alternates branch into a tree, and older variants hang off the original', () => {
  let board = build([sketch('home'), { type: 'frame.variant', id: 'home', newId: 'grid' }, { type: 'frame.variant', id: 'home', newId: 'list' }])
  board = applyOp(board, { type: 'frame.variant', id: 'grid', newId: 'grid-dense' }, person)
  // A variant from before branching was recorded.
  board = applyOp(board, { type: 'frame.variant', id: 'list', newId: 'legacy' }, person)
  board.frames.find((f) => f.id === 'legacy')!.variantOf = undefined

  const nodes = alternateTree(board, board.frames.find((f) => f.id === 'grid-dense')!)
  const rows = generations(nodes).map((row) => row.map((n) => n.frame.id))
  assert.deepEqual(rows, [['home'], ['grid', 'list', 'legacy'], ['grid-dense']])
  assert.equal(nodes.find((n) => n.frame.id === 'grid-dense')!.parent!.id, 'grid')
  // A frame with no deck is its own tree of one.
  const alone = build([sketch('solo')])
  assert.deepEqual(alternateTree(alone, alone.frames[0]!).map((n) => n.depth), [0])
})

test('an alternates request names the tool, the frame and its size', () => {
  const text = alternatesRequest({ id: 'f1', name: 'Pricing', kind: 'sketch', w: 1280, h: 900, route: '/pricing' }, 3, '')
  assert.match(text, /Make 3 alternates of the frame “Pricing” \(frame f1\)/)
  assert.match(text, /create_sketch with variant_of f1, width 1280, height 900, route \/pricing/)
  assert.match(alternatesRequest({ id: 'f1', name: 'P', kind: 'sketch', w: 1, h: 1 }, 2, 'darker, denser'), /Direction: darker, denser/)
})

test('links are read from the HTML, skipping back links', () => {
  assert.deepEqual(linksOf(`<a data-zeko-goto="cart">Cart</a><button data-zeko-goto='back'>Back</button><a data-zeko-goto='pay'>`), ['cart', 'pay'])
  assert.deepEqual(linksOf(undefined), [])
})

test('the state map runs from the start screen along links and lists missing states', () => {
  let board = build([
    sketch('home', { route: '/', html: '<body><a data-zeko-goto="cart">Cart</a><a data-zeko-goto="cart">Bag</a></body>', y: 0 }),
    sketch('cart', { route: '/cart', html: '<body><a data-zeko-goto="pay">Pay</a></body>', y: 400 }),
    sketch('cart-empty', { route: '/cart', state: 'empty', y: 800 }),
    sketch('pay', { route: '/pay', y: 1200 }),
    sketch('notes', { y: 1600 }),
    { type: 'frame.create', frame: { id: 'box', kind: 'sketch', name: 'box', shape: 'rect', x: 0, y: 0, w: 10, h: 10 } },
  ])
  board = applyOp(board, { type: 'board.update', flowStart: 'home' }, person)
  const map = stateMap(board, board.pages?.[0]?.id ?? 'page-1')
  const at = (id: string) => map.nodes.find((n) => n.id === id)!
  assert.equal(map.start, 'home')
  assert.deepEqual(['home', 'cart', 'pay'].map((id) => at(id).level), [0, 1, 2])
  assert.equal(at('cart-empty').level, at('cart').level, 'an unlinked state sits beside its screen')
  assert.equal(at('cart-empty').state, 'empty')
  assert.ok(!map.nodes.some((n) => n.id === 'box'), 'shapes are not screens')
  assert.ok(at('notes').level > at('pay').level)
  assert.deepEqual(map.edges.find((e) => e.from === 'home')!, { from: 'home', to: 'cart', count: 2 })
  // Every routed screen should have loading, empty and error; the cart already has empty.
  const missing = map.missing.map((m) => `${m.route}:${m.state}`)
  assert.ok(missing.includes('/cart:loading') && !missing.includes('/cart:empty') && missing.includes('/:error'))
  assert.ok(!map.missing.some((m) => m.screen === 'notes'), 'screens without a route get no suggestions')
  const ask = missingStateRequest(map.missing.filter((m) => m.route === '/cart'))
  assert.match(ask, /Design 2 missing states/)
  assert.match(ask, /The loading state of \/cart, based on “cart” \(frame cart\)/)
})

test('a variant shown on the canvas stands in for its deck in the state map', () => {
  let board = build([sketch('home', { route: '/', html: '<body><a data-zeko-goto="cart">Cart</a></body>' }), sketch('cart', { route: '/cart', y: 400 })])
  board = applyOp(board, { type: 'frame.variant', id: 'cart', newId: 'cart-2' }, person)
  board = applyOp(board, { type: 'board.update', flowStart: 'home' }, person)
  const map = stateMap(board, board.pages?.[0]?.id ?? 'page-1')
  assert.deepEqual(map.edges, [{ from: 'home', to: 'cart-2', count: 1 }])
  assert.ok(!map.nodes.some((n) => n.id === 'cart'))
})
