import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/inbox/unread-count')({
  server: {
    handlers: {
      GET: async () => Response.json({ count: 0 }),
    },
  },
})
