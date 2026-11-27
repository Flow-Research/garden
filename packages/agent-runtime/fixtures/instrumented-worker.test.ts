import { describe, expect, it } from 'vitest'
import { missingNativeBoundaries } from './instrumented-worker'

describe('native coverage receipt integrity', () => {
  const expected = [
    { role: 'issue', runId: 'resumed', invocation: '0:start', count: 1 },
    { role: 'issue', runId: 'resumed', invocation: '1:resume', count: 1 },
    { role: 'writeback', runId: 'resumed', invocation: 'writeback', count: 1 },
    { role: 'issue', runId: 'later', invocation: '0:start', count: 1 },
    { role: 'writeback', runId: 'later', invocation: 'writeback', count: 1 },
  ]
  const receipts = expected.map(({ role, runId, invocation }, index) => ({
    role,
    runId,
    invocation,
    isolate: 'native-isolate',
    sequence: index + 1,
  }))

  it('accepts all declared turn and completion receipts', () => {
    expect(missingNativeBoundaries(receipts, expected)).toEqual([])
  })

  it('detects a dropped writeback receipt despite another run with that role', () => {
    const dropped = receipts.filter(
      ({ role, runId }) => role !== 'writeback' || runId !== 'later',
    )
    expect(missingNativeBoundaries(dropped, expected)).toEqual([expected[4]])
  })

  it('does not count duplicate log delivery as the missing resumed turn', () => {
    const duplicate = [
      ...receipts.filter((receipt) => receipt.invocation !== '1:resume'),
      receipts[0]!,
    ]
    expect(missingNativeBoundaries(duplicate, expected)).toEqual([expected[1]])
  })

  it('does not count a genuine retried start as the missing resumed turn', () => {
    const retry = [
      ...receipts.filter((receipt) => receipt.invocation !== '1:resume'),
      { ...receipts[0]!, sequence: 99 },
    ]
    expect(missingNativeBoundaries(retry, expected)).toEqual([expected[1]])
  })
})
