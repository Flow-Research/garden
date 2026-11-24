import { describe, expect, it } from 'vitest'
import { classifyRunFailure } from './run-failure-matchers'

describe('runtime run failure matchers', () => {
  it('matches the Cloudflare subrequest limit message', () => {
    expect(
      classifyRunFailure({ error: new Error('Too many subrequests') }).cause,
    ).toBe('subrequest_limit')
  })

  it('preserves Workers AI model retirement detection for code 5028', () => {
    expect(
      classifyRunFailure({
        error: new Error(
          'Workers AI API error (410 Gone): {"errors":[{"code":5028,"message":"Model has been deprecated"}]}',
        ),
      }).cause,
    ).toBe('model_retired')
  })

  it('classifies a Workers AI model-unavailable error', () => {
    expect(
      classifyRunFailure({ error: new Error('Model not found: @cf/missing') })
        .cause,
    ).toBe('model_unavailable')
  })

  it('classifies a model capacity error', () => {
    expect(
      classifyRunFailure({
        error: new Error('Workers AI model capacity exceeded'),
      }).cause,
    ).toBe('model_unavailable')
  })

  it('uses unknown for unrelated errors', () => {
    expect(
      classifyRunFailure({ error: new Error('unrelated failure') }).cause,
    ).toBe('unknown')
  })
})
