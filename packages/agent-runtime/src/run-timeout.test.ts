import { describe, expect, it } from 'vitest'
import { DECIDE_ANALYSIS_OWNER_WAIT_MS } from './decide-analysis-types'
import { runExceededTimeout } from './run-timeout'

const HOUR = 60 * 60 * 1000
const now = new Date('2026-11-03T12:00:00Z')
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * HOUR)

describe('runExceededTimeout', () => {
  it('fails a run that has worked past its timeout', () => {
    expect(
      runExceededTimeout({
        startedAt: hoursAgo(2.5),
        timeoutSec: 2 * 60 * 60,
        pausedMs: 0,
        now,
      }),
    ).toBe(true)
  })

  it('does not count time paused on Decide against the timeout', () => {
    expect(
      runExceededTimeout({
        startedAt: hoursAgo(2.5),
        timeoutSec: 2 * 60 * 60,
        pausedMs: DECIDE_ANALYSIS_OWNER_WAIT_MS,
        now,
      }),
    ).toBe(false)
  })

  it('still fails a run whose working time alone passes the timeout', () => {
    expect(
      runExceededTimeout({
        startedAt: hoursAgo(4),
        timeoutSec: 2 * 60 * 60,
        pausedMs: HOUR,
        now,
      }),
    ).toBe(true)
  })

  it('treats a run with no start time as just started', () => {
    expect(
      runExceededTimeout({
        startedAt: null,
        timeoutSec: 60,
        pausedMs: 0,
        now,
      }),
    ).toBe(false)
  })
})
