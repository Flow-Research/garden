import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/github/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const setupUrl = new URL('/api/github/setup', request.url)

        for (const key of ['installation_id', 'setup_action', 'state']) {
          const value = url.searchParams.get(key)
          if (value) setupUrl.searchParams.set(key, value)
        }

        return new Response(null, {
          status: 302,
          headers: { location: setupUrl.toString() },
        })
      },
    },
  },
})
