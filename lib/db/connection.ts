import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

export function databaseUrl() {
  const value = process.env.DATABASE_URL?.trim()
  if (!value) return undefined
  let url: URL
  try { url = new URL(value) } catch { throw new Error('DATABASE_URL is not a valid PostgreSQL URL.') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.')
  }
  if ((url.hostname.endsWith('.supabase.com') || url.hostname.endsWith('.supabase.co')) && !url.searchParams.has('sslmode') && !url.searchParams.has('ssl')) {
    url.searchParams.set('sslmode', 'verify-full')
  }
  return url.href
}

export function connectDatabase(connectionString: string) {
  const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000, query_timeout: 10000 })
  pool.on('error', () => console.error('Zeko PostgreSQL idle connection closed.'))
  return { db: drizzle({ client: pool }), close: () => pool.end() }
}

const globalDatabase = globalThis as typeof globalThis & {
  __zekoWorkspaceDatabase?: ReturnType<typeof connectDatabase>['db']
}

export function workspaceDatabase(connectionString = databaseUrl()) {
  if (!connectionString) throw new Error('DATABASE_URL is required for Google sign-in.')
  return (globalDatabase.__zekoWorkspaceDatabase ??= connectDatabase(connectionString).db)
}
