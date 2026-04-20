import { defineConfig } from 'drizzle-kit'
import { serverEnv } from '@garden/env'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: serverEnv.DATABASE_URL,
  },
})
