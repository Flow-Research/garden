import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/inbox')({
  server: {
    handlers: {
      GET: async () => Response.json([]),
    },
  },
})
