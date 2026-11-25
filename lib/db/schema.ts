import { jsonb, pgSchema, primaryKey, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import type { Board } from '../types'

export const canvases = pgSchema('zeko').table('canvases', {
  id: varchar({ length: 40 }).primaryKey(),
  snapshot: jsonb().$type<Board>().notNull(),
  revision: uuid().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
})

export const accountCanvases = pgSchema('zeko').table('account_canvases', {
  ownerId: varchar('owner_id', { length: 64 }).notNull(),
  id: varchar({ length: 40 }).notNull(),
  snapshot: jsonb().$type<Board>().notNull(),
  revision: uuid().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [primaryKey({ columns: [table.ownerId, table.id] })])
