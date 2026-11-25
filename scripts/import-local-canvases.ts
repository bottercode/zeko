import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadEnvConfig } from '@next/env'
import { connectDatabase, databaseUrl } from '../lib/db/connection'
import { canvases } from '../lib/db/schema'
import { SAMPLE_ID } from '../lib/seed'
import type { Board } from '../lib/types'

async function localCanvases() {
  const directory = join(process.cwd(), '.zeko', 'boards')
  const files = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const rows = files.filter((file) => file.isFile() && /^[\w-]{1,40}\.json$/.test(file.name))
    .map((file) => ({ id: file.name.slice(0, -5), path: join(directory, file.name) }))
  if (!rows.length) rows.push({ id: SAMPLE_ID, path: join(process.cwd(), '.zeko', 'board.json') })
  return (await Promise.all(rows.map(async ({ id, path }) => {
    const raw = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (!files.length && id === SAMPLE_ID && error.code === 'ENOENT') return null
      throw error
    })
    if (raw === null) return undefined
    const snapshot = JSON.parse(raw) as Board
    if (!snapshot || typeof snapshot.name !== 'string' || !Array.isArray(snapshot.frames) || !Array.isArray(snapshot.tasks)) {
      throw new Error(`The local canvas ${id} is invalid.`)
    }
    return { id, snapshot, revision: randomUUID() }
  }))).filter((row) => row !== undefined)
}

async function main() {
  loadEnvConfig(process.cwd())
  const url = databaseUrl()
  if (!url) throw new Error('Set DATABASE_URL before importing canvases.')
  const rows = await localCanvases()
  if (!rows.length) {
    console.log('No local canvases to import.')
    return
  }
  const { db, close } = connectDatabase(url)
  try {
    const inserted = await db.transaction(async (tx) => {
      let count = 0
      for (const row of rows) {
        const saved = await tx.insert(canvases).values(row).onConflictDoNothing().returning({ id: canvases.id })
        count += saved.length
      }
      return count
    })
    console.log(`Imported ${inserted} canvases. Skipped ${rows.length - inserted} existing canvas IDs.`)
  } finally {
    await close()
  }
}

void main().catch(() => {
  console.error('Could not import local canvases. Check .zeko/boards and DATABASE_URL, and run npm run db:migrate first.')
  process.exitCode = 1
})
