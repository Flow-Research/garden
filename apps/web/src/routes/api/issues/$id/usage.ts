import { createFileRoute } from '@tanstack/react-router'
import {
  requireSession,
  unauthorized,
} from '@/lib/server/control-plane'

export const Route = createFileRoute('/api/issues/$id/usage')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        return Response.json({
          total_input_tokens: 0,
          total_output_tokens: 0,
          total_cache_read_tokens: 0,
          total_cache_write_tokens: 0,
          task_count: 0,
        })
      },
    },
  },
})
