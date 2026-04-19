import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/issues/search')({
  server: {
    handlers: {
      GET: async () => Response.json({ issues: [] }),
    },
  },
})
