import { isNotFound, isRedirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'
import {
  createGardenLogger,
  errorFields,
  requestFields,
  responseFields,
  type GardenLogFields,
} from '@garden/observability/logger'

const apiRequestLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'api-request',
})

type ApiThrownResponse = {
  body: { error: string; requestId: string }
  level: 'warn' | 'error'
  status: number
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const record = error as { status?: unknown; statusCode?: unknown }
  const candidate = record.status ?? record.statusCode
  return typeof candidate === 'number' && candidate >= 400 && candidate <= 599
    ? candidate
    : null
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : null
}

/**
 * Converts framework and HTTP-shaped throws into API responses without losing
 * observability. TanStack's request middleware treats returned `Response`
 * objects as handled, so API routes should cross this boundary as JSON rather
 * than as H3/TanStack `HTTPError` throws that clients see as unhandled. We only
 * expose messages for expected 4xx classes; unknown 5xx still logs full cause
 * server-side and returns a sanitized body.
 */
function responseForApiThrow(
  error: unknown,
  requestId: string,
): ApiThrownResponse | Response {
  if (error instanceof Response) return error

  if (isNotFound(error)) {
    return {
      status: 404,
      level: 'warn',
      body: { error: 'Not found', requestId },
    }
  }

  const status = errorStatus(error) ?? 500
  const isClientError = status >= 400 && status < 500
  return {
    status,
    level: isClientError ? 'warn' : 'error',
    body: {
      error: isClientError
        ? (errorMessage(error) ?? 'Request failed')
        : 'Internal server error',
      requestId,
    },
  }
}

async function responseBodyPreview(response: Response) {
  return await response
    .clone()
    .text()
    .then(
      (body) => ({ responseBodyPreview: body.slice(0, 1_000) }),
      (error) => ({
        responseBodyPreview: '[unavailable]',
        ...errorFields(error),
      }),
    )
}

/**
 * Global TanStack Start request logging boundary. This is the app-route layer
 * where server route handlers still expose their original thrown cause, so it is
 * the right place to prevent generic framework `HTTPError` responses from being
 * the only observable failure. This deliberately avoids `better-result`: request
 * middleware errors are framework boundary control-flow, not domain outcomes. It
 * classifies thrown API failures into explicit JSON responses while preserving
 * TanStack redirects/SSR errors for router handling. References checked:
 * TanStack Start request middleware source (`executeMiddleware` normalizes
 * returned `Response` objects), TanStack Router `isNotFound` / `isRedirect`, and
 * Cloudflare Workers structured JSON logging.
 */
export const apiRequestLoggingMiddleware = createMiddleware().server(
  async ({ next, pathname, request, serverFnMeta }) => {
    const startedAt = performance.now()
    const fields = requestFields(request)
    const logger = apiRequestLogger.child({
      ...fields,
      pathname,
      ...(serverFnMeta?.name ? { serverFnName: serverFnMeta.name } : {}),
    })

    return await Promise.resolve(next()).then(
      async (result) => {
        const response = result.response
        if (response.status >= 500 && response.status <= 599) {
          logger.error('api.request.response_error', {
            ...responseFields(response, startedAt),
            ...(await responseBodyPreview(response)),
          })
        }

        return result
      },
      (error) => {
        if (isRedirect(error)) throw error

        if (pathname.startsWith('/api/')) {
          const apiResponse = responseForApiThrow(error, fields.requestId)
          if (apiResponse instanceof Response) return apiResponse

          logger[apiResponse.level]('api.request.thrown', {
            status: apiResponse.status,
            handled: true,
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
            ...errorFields(error),
          })

          return Response.json(apiResponse.body, { status: apiResponse.status })
        }

        logger.error('api.request.thrown', {
          handled: false,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          ...errorFields(error),
        })
        throw error
      },
    )
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
    ...input.fields,
    ...errorFields(input.error),
  })
}
