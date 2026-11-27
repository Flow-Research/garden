import { wrapLanguageModel } from 'ai'
import { isRetiredModelError } from './run-failure-matchers'

type WrappableLanguageModel = Parameters<typeof wrapLanguageModel>[0]['model']

// AI SDK replaces stream errors with this text when Think calls
// toUIMessageStream without onError.
const SDK_MASKED_ERROR = 'An error occurred.'

/** Reports a provider retirement before AI SDK masks the stream error. */
export function observeRetiredAgentModel(
  model: WrappableLanguageModel,
  onRetired: () => void,
) {
  const observe = <T>(call: () => PromiseLike<T>) =>
    Promise.resolve(call()).catch((error: unknown) => {
      if (isRetiredModelError(error)) onRetired()
      throw error
    })
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v3',
      wrapGenerate: ({ doGenerate }) => observe(doGenerate),
      wrapStream: ({ doStream }) => observe(doStream),
    },
  })
}

/**
 * Remembers a retirement for the latest turn only, because one facet can host
 * many runs and a later masked failure may have a different cause.
 */
export function createRetiredModelTracker() {
  let retiredRunId: string | null = null
  return {
    observeTurn(runId: string) {
      retiredRunId = null
      return () => {
        retiredRunId = runId
      }
    },
    wasRetired(runId: string, reason: string) {
      return retiredRunId === runId && reason === SDK_MASKED_ERROR
    },
  }
}
