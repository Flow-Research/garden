import { describe, expect, it } from 'vitest'
import type { ChatDecideAnalysis } from '@/lib/api'
import { decideAnalysisOptions } from './queries'

function intervalFor(
  status: ChatDecideAnalysis['status'] | null,
  queryStatus: 'pending' | 'success' | 'error' = 'success',
) {
  const interval = decideAnalysisOptions('thread-1', 'run-1').refetchInterval
  const data = status ? { runId: 'run-1', status, progress: null } : undefined
  return typeof interval === 'function'
    ? // Only `state.data` and `state.status` are read by the interval function.
      interval({
        state: { data, status: queryStatus },
      } as unknown as Parameters<typeof interval>[0])
    : interval
}

describe('Decide analysis status polling', () => {
  it('polls until the run settles', () => {
    expect(intervalFor(null)).toBe(3000)
    expect(intervalFor('queued')).toBe(3000)
    expect(intervalFor('running')).toBe(3000)
    expect(intervalFor('cancel_requested')).toBe(3000)
  })

  it('stops once the run is complete, failed, or cancelled', () => {
    expect(intervalFor('completed')).toBe(false)
    expect(intervalFor('failed')).toBe(false)
    expect(intervalFor('cancelled')).toBe(false)
  })
  it('stops when the status request fails, such as a 404', () => {
    expect(intervalFor(null, 'error')).toBe(false)
    expect(intervalFor('running', 'error')).toBe(false)
  })
})
