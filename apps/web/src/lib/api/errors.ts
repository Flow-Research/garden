import { TaggedError } from 'better-result'

export class ApiError extends TaggedError('ApiError')<{
  message: string
  status: number
  statusText: string
}>() {}

export function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback
}
