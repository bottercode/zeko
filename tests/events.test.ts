import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eventStream } from '../lib/server/events'

const decoder = new TextDecoder()

function fixture(delivery: 'snapshot' | 'ordered') {
  const abort = new AbortController()
  let publish!: (value: number) => void
  let cleanups = 0
  const response = eventStream(abort.signal, () => 0, (send) => {
    publish = send
    return () => { cleanups++ }
  }, delivery)
  const reader = response.body!.getReader()
  return {
    publish,
    async next() {
      const { value } = await reader.read()
      return value && JSON.parse(decoder.decode(value).slice(6))
    },
    async close() {
      abort.abort()
      assert.equal((await reader.read()).done, true)
      assert.equal(cleanups, 1)
    },
  }
}

test('canvas snapshots keep the latest state for a slow reader', async () => {
  const stream = fixture('snapshot')
  try {
    for (let i = 1; i <= 60; i++) stream.publish(i)
    assert.equal(await stream.next(), 0)
    assert.equal(await stream.next(), 60)
  } finally { await stream.close() }
})

test('CLI relay commands preserve order and every message in a burst', async () => {
  const stream = fixture('ordered')
  try {
    for (let i = 1; i <= 4; i++) stream.publish(i)
    for (let i = 0; i <= 4; i++) assert.equal(await stream.next(), i)
  } finally { await stream.close() }
})
