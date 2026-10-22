import type { AppRequestContext } from '@/lib/server/context'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** The part of a TanStack Start file route that tests need. */
type ServerRoute = { options: { server?: { handlers?: unknown } } }

/**
 * Calls one method handler of a TanStack Start server route and returns its
 * Response. The route's own types (literal pathnames, middleware context) are
 * checked where the route is defined; tests only need to call the handler, so
 * it is looked up and invoked structurally, and a non-Response result throws.
 */
export async function invokeRouteHandler(
  route: ServerRoute,
  method: HttpMethod,
  input: {
    context: AppRequestContext
    request: Request
    params?: Record<string, string>
  },
): Promise<Response> {
  const handlers = route.options.server?.handlers
  if (!handlers || typeof handlers !== 'object') {
    throw new Error('Route has no server handlers')
  }
  const handler = Object.entries(handlers).find(([key]) => key === method)?.[1]
  if (typeof handler !== 'function') {
    throw new Error(`Route has no ${method} handler`)
  }

  const result: unknown = await handler({
    context: input.context,
    request: input.request,
    params: input.params ?? {},
    pathname: new URL(input.request.url).pathname,
    next: () => ({ isNext: true, context: undefined }),
  })
  if (!(result instanceof Response)) {
    throw new Error(`${method} handler did not return a Response`)
  }
  return result
}
