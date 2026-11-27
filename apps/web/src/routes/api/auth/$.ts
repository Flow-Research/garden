import { createFileRoute } from '@tanstack/react-router'
import { connectorCallbackRequest } from '@/lib/auth/connector-callback-request'
import { requireAppRequestContext } from '@/lib/server/context'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        return (await appContext.auth.getAuth()).handler(
          connectorCallbackRequest(request, appContext.env),
        )
      },
      POST: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        return (await appContext.auth.getAuth()).handler(request)
      },
      OPTIONS: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        return (await appContext.auth.getAuth()).handler(request)
      },
    },
  },
})
