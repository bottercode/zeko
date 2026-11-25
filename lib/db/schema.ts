import { jsonb, pgSchema, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import type { Board } from '../types'

export const canvases = pgSchema('zeko').table('canvases', {
  id: varchar({ length: 40 }).primaryKey(),
  snapshot: jsonb().$type<Board>().notNull(),
  revision: uuid().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
})
