import { describe, expect, it } from 'vitest'
import {
  QA_SWEEP_EXECUTION_CONFIG,
  QA_SWEEP_OUTPUT_CONFIG,
  isQaSweepAutomation,
} from './templates'

describe('isQaSweepAutomation', () => {
  it('recognises the QA sweep template by execution or output config', () => {
    expect(
      isQaSweepAutomation({
        executionConfig: QA_SWEEP_EXECUTION_CONFIG,
        outputConfig: null,
      }),
    ).toBe(true)
    expect(
      isQaSweepAutomation({
        executionConfig: null,
        outputConfig: QA_SWEEP_OUTPUT_CONFIG,
      }),
    ).toBe(true)
  })

  it('does not treat other automations as QA sweeps', () => {
    expect(
      isQaSweepAutomation({ executionConfig: null, outputConfig: null }),
    ).toBe(false)
    expect(
      isQaSweepAutomation({
        executionConfig: { templateId: 'triage' },
        outputConfig: { contractId: 'triage-report' },
      }),
    ).toBe(false)
  })
})
