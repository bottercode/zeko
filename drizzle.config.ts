import { loadEnvConfig } from '@next/env'
import { defineConfig } from 'drizzle-kit'
import { databaseUrl } from './lib/db/connection'

loadEnvConfig(process.cwd())
const url = databaseUrl()

export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/db/schema.ts',
  out: './drizzle',
  migrations: { schema: 'zeko', table: 'schema_migrations' },
  dbCredentials: url ? { url } : undefined,
})
