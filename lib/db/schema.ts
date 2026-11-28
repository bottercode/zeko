import { boolean, index, jsonb, pgSchema, primaryKey, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import type { Board } from '../types'

const zeko = pgSchema('zeko')

export const users = zeko.table('users', {
  id: varchar({ length: 64 }).primaryKey(),
  email: text(),
  name: text(),
  image: text(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
  /** the team the person had open last; sign-in reopens it while they are still a member */
  lastTeamId: varchar('last_team_id', { length: 64 }),
}, (table) => [index('users_email_idx').on(table.email)])

/**
 * Every canvas belongs to a team, and every person is in at least one: their personal team, whose ID is
 * their user ID (so canvases and agent credentials from before teams keep working). It can't be left or deleted.
 */
export const teams = zeko.table('teams', {
  id: varchar({ length: 64 }).primaryKey(),
  name: text().notNull(),
  personal: boolean().notNull().default(false),
  createdBy: varchar('created_by', { length: 64 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const teamMembers = zeko.table('team_members', {
  teamId: varchar('team_id', { length: 64 }).notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: varchar('user_id', { length: 64 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text({ enum: ['owner', 'member'] }).notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.teamId, table.userId] }),
  index('team_members_user_idx').on(table.userId),
])

/** Invite links: anyone signed in with the link joins the team as a member until it expires or is reset. */
export const teamInvites = zeko.table('team_invites', {
  tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
  teamId: varchar('team_id', { length: 64 }).notNull().references(() => teams.id, { onDelete: 'cascade' }),
  createdBy: varchar('created_by', { length: 64 }).references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => [index('team_invites_team_idx').on(table.teamId)])

export const oauthAccounts = zeko.table('oauth_accounts', {
  provider: text().notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  userId: varchar('user_id', { length: 64 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.provider, table.providerAccountId] }),
  unique().on(table.userId, table.provider),
])

export const mcpOAuthGrants = zeko.table('mcp_oauth_grants', {
  tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
  userId: varchar('user_id', { length: 64 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** the team the person granted access to */
  teamId: varchar('team_id', { length: 64 }).references(() => teams.id, { onDelete: 'cascade' }),
  clientHash: varchar('client_hash', { length: 64 }).notNull(),
  kind: text({ enum: ['code', 'refresh'] }).notNull(),
  redirectUri: text('redirect_uri'),
  challenge: varchar({ length: 43 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => [
  index('mcp_oauth_grants_expiry_idx').on(table.expiresAt),
  index('mcp_oauth_grants_user_idx').on(table.userId),
])

export const canvases = zeko.table('canvases', {
  id: varchar({ length: 40 }).primaryKey(),
  snapshot: jsonb().$type<Board>().notNull(),
  revision: uuid().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
})

/** Canvases of a team. owner_id is the team's ID. */
export const accountCanvases = zeko.table('account_canvases', {
  ownerId: varchar('owner_id', { length: 64 }).notNull().references(() => teams.id, { onDelete: 'cascade' }),
  id: varchar({ length: 40 }).notNull(),
  snapshot: jsonb().$type<Board>().notNull(),
  revision: uuid().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [primaryKey({ columns: [table.ownerId, table.id] })])
