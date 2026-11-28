import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/github/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)

        // GitHub sends the App's user authorization ("Link with GitHub") to
        // the same registered callback as installs. Installs always carry
        // installation_id; a bare code is the identity flow.
        if (
          url.searchParams.get('code') &&
          !url.searchParams.get('installation_id')
        ) {
          const completeUrl = new URL(
            '/api/github/identity/complete',
            request.url,
          )
          for (const key of ['code', 'state']) {
            const value = url.searchParams.get(key)
            if (value) completeUrl.searchParams.set(key, value)
          }
          return new Response(null, {
            status: 302,
            headers: { location: completeUrl.toString() },
          })
        }

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
