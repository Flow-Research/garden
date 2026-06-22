import { Result } from 'better-result'
import { createServerFn } from '@tanstack/react-start'
import {
  requireAppRequestContext,
  type GardenAuthSession,
} from '@/lib/server/context'
import {
  createGardenLogger,
  errorFields,
  requestFields,
} from '@garden/observability/logger'

const routeSessionLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'route-session',
})

/**
 * Returns the active route-guard session from request-scoped app context.
 * Loaders/server functions read auth from `context`, not from global bindings,
 * so sign-in redirects see the same cookie and origin as the auth API request.
 * A transient auth/session storage failure used to escape this helper, then
 * TanStack Start serialized it into the SSR stream and PostHog captured it as an
 * unmappable inline `/login` script error. Returning `null` keeps route guards on
 * the normal unauthenticated redirect path while server logs preserve the real
 * cause. References: TanStack Router auth guards, TanStack Start server context,
 * PostHog source-map docs, and better-result `Result.tryPromise` boundary
 * wrapping.
 */
export const getRouteSession = createServerFn({ method: 'GET' }).handler(
  async ({ context }) => {
    const appContext = requireAppRequestContext(context)
    const result = await Result.tryPromise({
      try: async () => await appContext.auth.getSession(),
      catch: (cause) => cause,
    })

    if (result.isErr()) {
      routeSessionLogger.warn('auth.route_session.degraded', {
        ...requestFields(appContext.request),
        ...errorFields(result.error),
      })
      return null
    }

    return toRouteSession(result.value)
  },
)

function toRouteSession(session: GardenAuthSession) {
  if (!session) return null

  return {
    userId: session.user.id,
  }
}
