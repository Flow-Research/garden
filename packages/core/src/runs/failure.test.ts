import { describe, expect, it } from 'vitest'
import { Result } from 'better-result'
import {
  RUN_FAILURE_CAUSES,
  classifyRunFailure,
  describeRunFailure,
  parseRunFailure,
  runFailure,
  toPublicRunFailure,
} from './failure'

describe('run failure registry', () => {
  it('maps every legacy reason code to its typed cause', () => {
    for (const cause of RUN_FAILURE_CAUSES) {
      const parsed = parseRunFailure({ reason: cause })
      expect(parsed).toEqual(Result.ok({ cause }))
    }
  })

  it('maps legacy reason aliases to their current causes', () => {
    expect(parseRunFailure({ reason: 'timeout' })).toEqual(
      Result.ok({ cause: 'turn_timed_out' }),
    )
    expect(parseRunFailure({ reason: 'tool_timeout' })).toEqual(
      Result.ok({ cause: 'tool_failed' }),
    )
    expect(parseRunFailure({ reason: 'stale_approval' })).toEqual(
      Result.ok({ cause: 'approval_stale' }),
    )
    expect(
      parseRunFailure({ reason: 'automation_completed_without_output' }),
    ).toEqual(Result.ok({ cause: 'no_output' }))
  })

  it('uses the approved copy for automation runs without output', () => {
    expect(describeRunFailure({ cause: 'no_output' })).toEqual({
      category: 'run_lifecycle',
      retryable: false,
      title: 'The automation finished without producing any output.',
      nextStep:
        "Add more detail to the automation's instructions and run it again.",
    })
  })

  it('maps token budget exhaustion to the approved platform limit copy', () => {
    expect(parseRunFailure({ reason: 'run_token_budget_exceeded' })).toEqual(
      Result.ok({ cause: 'run_token_budget_exceeded' }),
    )
    expect(describeRunFailure({ cause: 'run_token_budget_exceeded' })).toEqual({
      category: 'platform_limit',
      retryable: true,
      title: 'The run hit its limit of 2 million tokens.',
      nextStep:
        'Split the task into smaller issues, or narrow its scope, then try again.',
    })
  })

  it('maps unknown legacy text to safe unknown copy', () => {
    const raw = 'provider secret: customer prompt and token abc123'
    const parsed = parseRunFailure({ error: raw, reason: raw })

    expect(parsed).toEqual(Result.ok({ cause: 'unknown' }))
    expect(describeRunFailure(runFailure('unknown')).title).not.toContain(raw)
    expect(describeRunFailure(runFailure('unknown')).nextStep).not.toContain(
      raw,
    )
  })

  it('returns a typed error for malformed structured failure payloads', () => {
    expect(
      parseRunFailure({ failure: { cause: 'private raw text' } }).isErr(),
    ).toBe(true)
  })

  it('keeps cause definitions exhaustive for every registered code', () => {
    expect(RUN_FAILURE_CAUSES).toEqual(
      expect.arrayContaining([
        'output_cap_reached',
        'run_token_budget_exceeded',
        'unknown',
      ]),
    )
    for (const cause of RUN_FAILURE_CAUSES) {
      const description = describeRunFailure(runFailure(cause))
      expect(description.title.length).toBeGreaterThan(0)
      expect(description.nextStep.length).toBeGreaterThan(0)
    }
  })

  it('uses connector details for approved tool failure copy', () => {
    expect(
      describeRunFailure(
        runFailure('tool_failed', {
          connectorName: 'GitHub',
          connectorErrorKind: 'auth',
        }),
      ),
    ).toMatchObject({
      title: 'GitHub failed during the run.',
      nextStep: 'Reconnect GitHub in Connectors.',
    })
  })

  it('maps a ConnectorError kind into approved tool failure copy', () => {
    const failure = classifyRunFailure(
      {
        error: new Error('connector authorization expired'),
        toolError: { kind: 'auth_expired', connectorName: 'GitHub' },
      },
      [],
    )

    expect(describeRunFailure(failure)).toMatchObject({
      title: 'GitHub failed during the run.',
      nextStep: 'Reconnect GitHub in Connectors.',
    })
  })

  it('strips the private diagnostic from the public failure', () => {
    expect(
      toPublicRunFailure({
        ...runFailure('unknown'),
        diagnostic: 'private provider error',
      }),
    ).toEqual({ cause: 'unknown' })
  })
})
