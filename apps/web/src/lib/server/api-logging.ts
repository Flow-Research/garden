import { createMiddleware } from '@tanstack/react-start'
import { Result } from 'better-result'
import {
  createGardenLogger,
  errorFields,
  requestFields,
  responseFields,
  type GardenLogFields,
} from '@garden/core/observability/logger'

const apiRequestLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'api-request',
})

async function responseBodyPreview(response: Response) {
  const result = await Result.tryPromise({
    try: async () => await response.clone().text(),
    catch: (cause) => cause,
  })

  if (result.isErr()) {
    return {
      responseBodyPreview: '[unavailable]',
      ...errorFields(result.error),
    }
  }

  return {
    responseBodyPreview: result.value.slice(0, 1_000),
  }
}

/**
 * Global TanStack Start request logging boundary. This is the app-route layer
 * where server route handlers still expose their original thrown cause, so it is
 * the right place to prevent generic framework `HTTPError` responses from being
 * the only observable failure. It logs both thrown errors and returned 5xx
 * responses without changing the response or swallowing the throw. References:
 * TanStack Start request middleware docs and Cloudflare Workers structured JSON
 * logging docs.
 */
export const apiRequestLoggingMiddleware = createMiddleware().server(
  async ({ next, pathname, request, serverFnMeta }) => {
    const startedAt = performance.now()
    const logger = apiRequestLogger.child({
      ...requestFields(request),
      pathname,
      ...(serverFnMeta?.name ? { serverFnName: serverFnMeta.name } : {}),
    })

    const result = await Result.tryPromise({
      try: async () => await next(),
      catch: (cause) => cause,
    })

    if (result.isErr()) {
      logger.error('api.request.thrown', {
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        ...errorFields(result.error),
      })
      throw result.error
    }

    const response = result.value.response
    if (response.status >= 500 && response.status <= 599) {
      logger.error('api.request.response_error', {
        ...responseFields(response, startedAt),
        ...(await responseBodyPreview(response)),
      })
    }

    return result.value
  },
)

/**
 * Logs background or typed Result failures without changing caller control flow.
 * Use for `void` follow-up work and service Results that would otherwise become
 * only a user-facing JSON error with no indexed cause/context.
 */
export function logApiFailure(input: {
  request?: Request
  event: string
  fields?: GardenLogFields
  error: unknown
  level?: 'warn' | 'error'
}) {
  const logger = input.request
    ? apiRequestLogger.child(requestFields(input.request))
    : apiRequestLogger
  logger[input.level ?? 'error'](input.event, {
    ...(input.fields ?? {}),
    ...errorFields(input.error),
  })
}
