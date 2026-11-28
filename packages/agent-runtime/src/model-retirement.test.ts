import { streamText } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_MODEL_PROFILE } from './model'
import {
  createRetiredModelTracker,
  observeRetiredAgentModel,
} from './model-retirement'

const retiredError = new Error(
  'Workers AI API error (410 Gone): {"errors":[{"message":"AiError: Model has been deprecated: @cf/old was deprecated on 2026-11-20.","code":5028}],"success":false}',
)

async function failedStreamText(error: Error, onRetired: () => void) {
  const model = observeRetiredAgentModel(
    new MockLanguageModelV3({
      doStream: async () => {
        throw error
      },
    }),
    onRetired,
  )
  const result = streamText({ model, prompt: 'hi', onError: () => {} })
  let errorText: string | undefined
  for await (const chunk of result.toUIMessageStream()) {
    if (chunk.type === 'error') errorText = chunk.errorText
  }
  return errorText
}

describe('retired agent model', () => {
  it('does not default to the retired Kimi model', () => {
    expect(DEFAULT_AGENT_MODEL_PROFILE.id).not.toBe(
      '@cf/moonshotai/kimi-k2.7-code',
    )
    expect(DEFAULT_AGENT_MODEL_PROFILE.id).toBe(
      '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
    )
  })

  it('turns the SDK-masked 410/5028 failure into a clear reason', async () => {
    const tracker = createRetiredModelTracker()
    const masked = await failedStreamText(
      retiredError,
      tracker.observeTurn('run-1'),
    )

    expect(masked).toBe('An error occurred.')
    expect(tracker.wasRetired('run-1', masked ?? '')).toBe(true)
  })

  it('recognizes the deprecation text without an HTTP wrapper', async () => {
    const onRetired = vi.fn()
    await failedStreamText(
      new Error('AiError: Model has been deprecated: @cf/old'),
      onRetired,
    )

    expect(onRetired).toHaveBeenCalledOnce()
  })

  it('keeps unknown provider errors masked', async () => {
    const tracker = createRetiredModelTracker()
    const masked = await failedStreamText(
      new Error('500 retained customer text mentioning 5028'),
      tracker.observeTurn('run-1'),
    )

    expect(tracker.wasRetired('run-1', masked ?? '')).toBe(false)
  })

  it('does not relabel a different failure on a retired run', () => {
    const tracker = createRetiredModelTracker()
    tracker.observeTurn('run-1')()

    expect(tracker.wasRetired('run-1', 'turn_aborted')).toBe(false)
  })

  it('does not leak a retirement to another run in the same facet', () => {
    const tracker = createRetiredModelTracker()
    tracker.observeTurn('run-1')()
    tracker.observeTurn('run-2')

    expect(tracker.wasRetired('run-2', 'An error occurred.')).toBe(false)
  })

  it('does not leak a retirement to a later turn of the same run', () => {
    const tracker = createRetiredModelTracker()
    tracker.observeTurn('run-1')()
    tracker.observeTurn('run-1')

    expect(tracker.wasRetired('run-1', 'An error occurred.')).toBe(false)
  })
})
