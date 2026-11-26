import assert from 'node:assert/strict'
import { test } from 'node:test'
import { seedBoard } from '../lib/seed'
import { readBoardImport } from '../lib/server/board-import'

test('imports sample and older canvas exports', () => {
  const exported = seedBoard()
  const restored = readBoardImport(exported)
  assert(restored)
  assert.equal(restored.name, exported.name)
  assert.deepEqual(restored.frames, exported.frames)
  assert.deepEqual(restored.agents, {})
  assert(readBoardImport({ name: 'Older canvas', frames: [], decks: {}, comments: [], tasks: [] }))
})

test('rejects invalid nested data and duplicate frame IDs', () => {
  const exported = seedBoard()
  assert.equal(readBoardImport({ ...exported, frames: [null] }), undefined)
  assert.equal(readBoardImport({ ...exported, tasks: [null] }), undefined)
  assert.equal(readBoardImport({ ...exported, decks: [] }), undefined)
  assert.equal(readBoardImport({ ...exported, frames: [exported.frames[0], exported.frames[0]] }), undefined)
})
