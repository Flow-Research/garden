import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { AutomationRun } from '@/lib/api'
import { automationRunsOptions } from './queries'

vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  api: { listAutomationRuns: vi.fn() },
}))

function intervalFor(statuses: AutomationRun['status'][]) {
  const options = automationRunsOptions('ws-1', 'auto-1')
  const queryClient = new QueryClient()
  queryClient.setQueryData(
    options.queryKey,
    statuses.map(
      (status, index) => ({ id: `run-${index}`, status }) as AutomationRun,
    ),
  )
  const query = queryClient.getQueryCache().find({ queryKey: options.queryKey })
  const interval = options.refetchInterval
  return typeof interval === 'function' && query
    ? // The cache's query is untyped; it is this options' query.
      interval(query as unknown as Parameters<typeof interval>[0])
    : interval
}

describe('automation run history', () => {
  it('polls while a run is still pending, queued or running', () => {
    expect(intervalFor(['completed', 'queued'])).toBe(3000)
    expect(intervalFor(['running'])).toBe(3000)
  })

  it('stops polling once every run has settled', () => {
    expect(intervalFor(['completed', 'failed', 'skipped'])).toBe(false)
    expect(intervalFor([])).toBe(false)
  })
})
