import { TaggedError } from 'better-result'

export class ApiError extends TaggedError('ApiError')<{
  message: string
  status: number
  statusText: string
}>() {}

export function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback
}

/**
 * Whether a failed request means the thing is gone (or not visible to this
 * user), as opposed to a failure worth retrying. Detail pages show "not
 * found" only for these.
 */
export function isMissingError(cause: unknown) {
  return (
    cause instanceof ApiError && (cause.status === 404 || cause.status === 403)
  )
}
