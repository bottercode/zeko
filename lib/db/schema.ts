import { index, jsonb, pgSchema, primaryKey, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import type { Board } from '../types'

const zeko = pgSchema('zeko')

export const users = zeko.table('users', {
  id: varchar({ length: 64 }).primaryKey(),
  email: text(),
  name: text(),
  image: text(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
}, (table) => [index('users_email_idx').on(table.email)])

export const oauthAccounts = zeko.table('oauth_accounts', {
  provider: text().notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  userId: varchar('user_id', { length: 64 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.provider, table.providerAccountId] }),
  unique().on(table.userId, table.provider),
])

export const canvases = zeko.table('canvases', {
  id: varchar({ length: 40 }).primaryKey(),
  snapshot: jsonb().$type<Board>().notNull(),
  revision: uuid().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
})

export const accountCanvases = zeko.table('account_canvases', {
  ownerId: varchar('owner_id', { length: 64 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  id: varchar({ length: 40 }).notNull(),
  snapshot: jsonb().$type<Board>().notNull(),
  revision: uuid().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [primaryKey({ columns: [table.ownerId, table.id] })])
