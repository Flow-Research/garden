import {
  classifyRunFailure as classifyCoreRunFailure,
  type RunFailure,
  type RunFailureMatcher,
  type RunFailureSignal,
} from '@garden/core/runs/failure'

function messageFromError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return ''
}

/** Detects the provider retirement signal before the AI SDK masks it. */
export function isRetiredModelError(error: unknown): boolean {
  const message = messageFromError(error)
  return (
    /^(?:\w*Error:\s*)?(?:5028\b|Model has been deprecated:)/.test(message) ||
    (/API error \(410\b/.test(message) && /"code":\s*5028\b/.test(message))
  )
}

/** Runtime-specific error patterns used by issue and automation runs. */
export const RUNTIME_FAILURE_MATCHERS: readonly RunFailureMatcher[] = [
  {
    cause: 'model_retired',
    matches: (signal) =>
      signal.turnFlags?.modelRetired === true ||
      isRetiredModelError(signal.error),
  },
  {
    cause: 'subrequest_limit',
    matches: (signal) =>
      /too many subrequests/i.test(messageFromError(signal.error)),
  },
  {
    cause: 'model_unavailable',
    matches: (signal) => {
      const message = messageFromError(signal.error).toLowerCase()
      return (
        message.includes('model not found') ||
        message.includes('model does not exist') ||
        message.includes('model unavailable') ||
        message.includes('model is unavailable') ||
        (message.includes('capacity') &&
          (message.includes('model') || message.includes('workers ai')))
      )
    },
  },
]

/** Classifies a runtime failure with Cloudflare and Workers AI matchers. */
export function classifyRunFailure(signal: RunFailureSignal): RunFailure {
  return classifyCoreRunFailure(signal, RUNTIME_FAILURE_MATCHERS)
}
