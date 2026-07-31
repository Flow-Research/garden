import { isNotFound, isRedirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'
import { capturePostHogException } from '@/lib/posthog-server'
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

/** Represents a handler that completed normally but returned a server error.
 * PostHog auto-capture only sees uncaught exceptions, so this custom exception
 * makes intentionally returned 5xx responses visible without exposing bodies. */
class ReturnedApiResponseError extends Error {
  readonly status: number
  readonly path: string
  readonly requestId: string

  constructor(input: { status: number; path: string; requestId: string }) {
    super(`API returned HTTP ${input.status}`)
    this.name = 'ReturnedApiResponseError'
    this.status = input.status
    this.path = input.path
    this.requestId = input.requestId
  }
}

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

/** Sends a caught server failure to PostHog while keeping telemetry failure
 * secondary. Before this boundary, TanStack converted errors into Responses and
 * the outer Worker exception hook never saw them. */
async function captureApiException(input: {
  error: unknown
  event: string
  fields: GardenLogFields
  logger: ReturnType<typeof apiRequestLogger.child>
}) {
  await capturePostHogException({
    error: input.error,
    properties: {
      event: input.event,
      ...input.fields,
    },
  }).then(
    () => undefined,
    (captureError) => {
      input.logger.warn('posthog.exception_capture.failed', {
        ...errorFields(captureError),
      })
    },
  )
}

/** Extracts only known-safe correlation and error fields from returned JSON.
 * Logging an arbitrary response body could expose provider payloads or secrets,
 * so non-JSON and nested values are deliberately omitted. */
async function responseBodyPreview(response: Response) {
  return await response
    .clone()
    .json()
    .then(
      (body) => {
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return { responseBodyPreview: '[body omitted]' }
        }
        const record = body as Record<string, unknown>
        const preview = Object.fromEntries(
          ['error', 'code', 'requestId', 'traceId'].flatMap((key) =>
            typeof record[key] === 'string'
              ? [[key, record[key].slice(0, 500)]]
              : [],
          ),
        )
        return {
          responseBodyPreview:
            Object.keys(preview).length > 0
              ? JSON.stringify(preview)
              : '[body omitted]',
        }
      },
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
          if (!response.headers.has('x-garden-error-capture')) {
            await captureApiException({
              error: new ReturnedApiResponseError({
                status: response.status,
                path: fields.path,
                requestId: fields.requestId,
              }),
              event: 'api.request.response_error',
              fields,
              logger,
            })
          }
        }

        return result
      },
      async (error) => {
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
          if (apiResponse.status >= 500) {
            await captureApiException({
              error,
              event: 'api.request.thrown',
              fields,
              logger,
            })
          }

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
export interface ApiFailureInput {
  request?: Request
  event: string
  fields?: GardenLogFields
  error: unknown
  level?: 'warn' | 'error'
}

export function logApiFailure(input: ApiFailureInput) {
  const logger = input.request
    ? apiRequestLogger.child(requestFields(input.request))
    : apiRequestLogger
  logger[input.level ?? 'error'](input.event, {
    ...input.fields,
    ...errorFields(input.error),
  })
}

/** Logs and captures a caught typed failure before its caller degrades,
 * redirects, or converts it into an HTTP response. Use this when the original
 * exception would otherwise disappear before the global request boundary. */
export async function captureApiFailure(input: ApiFailureInput) {
  logApiFailure(input)
  const fields = input.request
    ? requestFields(input.request)
    : {
        requestId: crypto.randomUUID(),
        cfRay: null,
        method: null,
        path: null,
      }
  const logger = input.request
    ? apiRequestLogger.child(fields)
    : apiRequestLogger
  await captureApiException({
    error: input.error,
    event: input.event,
    fields,
    logger,
  })
}
