import { Result, TaggedError } from 'better-result'

export class AuthClientOperationError extends TaggedError(
  'AuthClientOperationError',
)<{
  cause: unknown
  message: string
  operation: string
}>() {}

type AuthClientResponse = {
  error?: { message?: string | null } | null
}

/**
 * Normalizes Better Auth client calls into one typed result. Better Auth can
 * report an operation failure either by rejecting the promise or by resolving
 * it with an `error` property. Handling only one path previously left OAuth
 * buttons busy forever. Reference: Better Auth 1.6.26 client endpoint types
 * and better-result 2.9.2 `Result.tryPromise` and `andThen` source.
 */
export async function authClientOperation<
  TResponse extends AuthClientResponse,
>(args: {
  fallbackMessage: string
  operation: string
  request: () => Promise<TResponse>
}) {
  const transportResult = await Result.tryPromise({
    try: args.request,
    catch: (cause) =>
      new AuthClientOperationError({
        cause,
        message: cause instanceof Error ? cause.message : args.fallbackMessage,
        operation: args.operation,
      }),
  })

  return transportResult.andThen((response) =>
    response.error
      ? Result.err(
          new AuthClientOperationError({
            cause: response.error,
            message: response.error.message || args.fallbackMessage,
            operation: args.operation,
          }),
        )
      : Result.ok(response),
  )
}
