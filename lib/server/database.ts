import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { connectDatabase } from '../db/connection'
import { canvases } from '../db/schema'
import type { Board } from '../types'

type CanvasRow = typeof canvases.$inferSelect
type Queue = { next?: CanvasRow; writing?: CanvasRow; running?: Promise<void>; timer?: ReturnType<typeof setTimeout> }

export class CanvasWriteConflict extends Error {}

/** Serialize writes per canvas. Keep the pending write ID on failure so an uncertain commit can be retried. */
export function databasePersistence(connectionString: string) {
  const { db } = connectDatabase(connectionString)
  const revisions = new Map<string, string>()
  const writes = new Map<string, Queue>()

  async function load() {
    const [rows, archived] = await Promise.all([
      db.select().from(canvases).where(isNull(canvases.archivedAt)),
      db.select({ id: canvases.id, revision: canvases.revision }).from(canvases).where(isNotNull(canvases.archivedAt)),
    ])
    for (const row of archived) revisions.set(row.id, row.revision)
    for (const row of rows) revisions.set(row.id, row.revision)
    return rows
  }

  async function save(row: CanvasRow) {
    const revision = revisions.get(row.id)
    const affected = revision
      ? await db.update(canvases).set(row).where(and(eq(canvases.id, row.id), eq(canvases.revision, revision))).returning({ id: canvases.id })
      : await db.insert(canvases).values(row).onConflictDoNothing().returning({ id: canvases.id })
    if (!affected.length) {
      const [stored] = await db.select({ revision: canvases.revision }).from(canvases).where(eq(canvases.id, row.id))
      if (stored?.revision !== row.revision) throw new CanvasWriteConflict('This canvas changed in another Zeko process. Restart Zeko to reload it.')
    }
    revisions.set(row.id, row.revision)
  }

  function schedule(id: string, queue: Queue, delay: number) {
    clearTimeout(queue.timer)
    queue.timer = setTimeout(() => {
      queue.timer = undefined
      void flush(id).catch((error: unknown) => {
        if (error instanceof CanvasWriteConflict) console.error(error.message)
        else console.error('Zeko could not save a canvas to PostgreSQL. Retrying.')
      })
    }, delay)
  }

  function flush(id: string): Promise<void> {
    const queue = writes.get(id)
    if (!queue) return Promise.resolve()
    if (queue.running) return queue.running
    clearTimeout(queue.timer)
    queue.timer = undefined
    queue.running = (async () => {
      while (queue.writing || queue.next) {
        if (!queue.writing) {
          queue.writing = queue.next!
          queue.next = undefined
        }
        await save(queue.writing)
        queue.writing = undefined
      }
    })().catch((error: unknown) => {
      if (!(error instanceof CanvasWriteConflict)) schedule(id, queue, 3000)
      throw error
    }).finally(() => {
      queue.running = undefined
      if (!queue.next && !queue.writing) writes.delete(id)
    })
    return queue.running
  }

  return {
    load,
    reserved: (id: string) => revisions.has(id) || writes.has(id),
    enqueue(id: string, snapshot: Board, archivedAt: Date | null = null) {
      const queue = writes.get(id) ?? {}
      writes.set(id, queue)
      queue.next = { id, snapshot, revision: randomUUID(), archivedAt }
      if (!queue.running) schedule(id, queue, 250)
    },
    flush,
  }
}
