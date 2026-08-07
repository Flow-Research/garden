import { Cause, Effect, Exit, Option } from 'effect'
import {
  createGardenLogger,
  errorFields,
  requestFields,
} from '@garden/observability/logger'
import { capturePostHogException } from '../posthog-server'

const executorLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'executor',
})

interface ExecutorCaptureContext {
  readonly event: string
  readonly request?: Request
  readonly tenant?: string
  readonly subject?: string
}

interface ExecutorHttpFailure {
  readonly status: number
  readonly message: string
}

export type ExecutorRouteOutcome<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly response: Response }

const isHttpFailure = (value: unknown): value is ExecutorHttpFailure => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { status?: unknown; message?: unknown }
  return (
    typeof candidate.status === 'number' &&
    candidate.status >= 400 &&
    candidate.status <= 599 &&
    typeof candidate.message === 'string'
  )
}

/** Captures one full Effect Cause without changing the original failure.
 * Executor preserves storage/plugin causes, Garden emits a redacted structured
 * log, and PostHog receives the squashed exception under the same trace id. */
const captureExecutorCause = Effect.fn('ExecutorObservability.captureCause')(
  function* (cause: Cause.Cause<unknown>, context: ExecutorCaptureContext) {
    const traceId = `executor-${crypto.randomUUID()}`
    const squashed = Cause.squash(cause)
    const fields = context.request ? requestFields(context.request) : {}

    executorLogger.error(context.event, {
      ...fields,
      traceId,
      tenant: context.tenant,
      subject: context.subject,
      ...errorFields(squashed),
    })

    yield* Effect.tryPromise({
      try: () =>
        capturePostHogException({
          error: squashed,
          distinctId: context.subject,
          properties: {
            event: context.event,
            traceId,
            tenant: context.tenant,
            ...fields,
          },
        }),
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          executorLogger.warn('executor.exception_capture.failed', {
            ...fields,
            traceId,
            ...errorFields(error),
          })
        }),
      ),
    )

    return traceId
  },
)

/** Runs an HTTP-bound Executor effect as Exit so typed failures, defects, and
 * interruptions remain inspectable. Unexpected/server failures are captured
 * before a sanitized Response is produced; expected 4xx failures are logged at
 * warn level without creating PostHog exception noise. */
export async function runExecutorRouteEffect<A, E>(input: {
  readonly effect: Effect.Effect<A, E>
  readonly request: Request
  readonly event: string
  readonly fallbackMessage: string
}): Promise<ExecutorRouteOutcome<A>> {
  let traceId: string | undefined
  const observed = input.effect.pipe(
    Effect.tapCause((cause) => {
      const failure = Cause.findErrorOption(cause)
      if (
        Option.isSome(failure) &&
        isHttpFailure(failure.value) &&
        failure.value.status < 500
      ) {
        return Effect.sync(() => {
          executorLogger.warn(input.event, {
            ...requestFields(input.request),
            ...errorFields(Cause.squash(cause)),
          })
        })
      }
      return captureExecutorCause(cause, {
        event: input.event,
        request: input.request,
      }).pipe(
        Effect.tap((capturedTraceId) =>
          Effect.sync(() => {
            traceId = capturedTraceId
          }),
        ),
      )
    }),
  )
  const exit = await Effect.runPromiseExit(observed)
  if (Exit.isSuccess(exit)) return { ok: true, value: exit.value }

  const typedFailure = Cause.findErrorOption(exit.cause)
  const failure = Option.isSome(typedFailure) ? typedFailure.value : null
  const status = isHttpFailure(failure) ? failure.status : 500
  const message = isHttpFailure(failure)
    ? failure.message
    : input.fallbackMessage
  const fields = requestFields(input.request)
  const body = {
    error: message,
    requestId: fields.requestId,
    ...(traceId ? { traceId } : {}),
  }
  return {
    ok: false,
    response: Response.json(body, {
      status,
      headers: traceId ? { 'x-garden-error-capture': traceId } : undefined,
    }),
  }
}
