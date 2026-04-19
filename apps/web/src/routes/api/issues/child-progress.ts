import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/issues/child-progress')({
  server: {
    handlers: {
      GET: async () => Response.json({ progress: [] }),
    },
  },
})
