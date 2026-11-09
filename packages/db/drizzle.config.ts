import { defineConfig } from 'drizzle-kit'
import { getServerEnv } from '@garden/env'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: getServerEnv().DATABASE_URL,
  },
  migrations: {
    schema: 'drizzle',
    table: '__drizzle_migrations',
  },
})
