import { createFileRoute } from '@tanstack/react-router'
import { createAuth } from '@/lib/auth'
import { appEnv } from '@/lib/server/env'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request }) => createAuth(appEnv).handler(request),
      POST: async ({ request }) => createAuth(appEnv).handler(request),
      OPTIONS: async ({ request }) => createAuth(appEnv).handler(request),
    },
  },
})
