import { createServerFn } from '@tanstack/react-start'
import { requireAppRequestContext } from '@/lib/server/context'

/**
 * Returns the active route-guard session from request-scoped app context.
 * Loaders/server functions read auth from `context`, not from global bindings,
 * so sign-in redirects see the same cookie and origin as the auth API request.
 * Reference: TanStack Router auth guards and TanStack Start server context.
 */
export const getRouteSession = createServerFn({ method: 'GET' }).handler(
  async ({ context }) => {
    const appContext = requireAppRequestContext(context)
    const session = await appContext.auth.getSession()
    if (!session) return null

    return {
      userId: session.user.id,
    }
  },
)
