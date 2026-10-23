import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { inboxKeys } from '@/lib/inbox/queries'
import { issueKeys } from '@/lib/issues/queries'
import { useRunProgressInvalidation } from './use-run-progress-invalidation'

type Progress = Parameters<typeof useRunProgressInvalidation>[0]

function setup(initial: Progress) {
  const queryClient = new QueryClient()
  const invalidate = vi
    .spyOn(queryClient, 'invalidateQueries')
    .mockResolvedValue(undefined)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const hook = renderHook(
    (progress: Progress) => useRunProgressInvalidation(progress),
    { initialProps: initial, wrapper },
  )
  const invalidatedKeys = () =>
    invalidate.mock.calls.map(([filters]) => filters?.queryKey)
  return { hook, invalidate, invalidatedKeys }
}

const BASE: Progress = {
  issueId: 'issue-1',
  workspaceId: 'ws-1',
  runId: 'run-1',
  status: 'running',
  latestSeq: 4,
}

describe('useRunProgressInvalidation', () => {
  it('does nothing on mount or when the poll returns the same progress', () => {
    const { hook, invalidate } = setup(BASE)

    hook.rerender({ ...BASE })

    expect(invalidate).not.toHaveBeenCalled()
  })

  it('refreshes only the timeline and work products for new events', () => {
    const { hook, invalidatedKeys } = setup(BASE)

    hook.rerender({ ...BASE, latestSeq: 5 })

    expect(invalidatedKeys()).toEqual([
      issueKeys.timeline('issue-1'),
      issueKeys.workProducts('issue-1'),
    ])
  })

  it('also refreshes the issue, list and inbox on a status transition', () => {
    const { hook, invalidatedKeys } = setup(BASE)

    hook.rerender({ ...BASE, status: 'waiting_for_approval', latestSeq: 5 })

    expect(invalidatedKeys()).toEqual([
      issueKeys.timeline('issue-1'),
      issueKeys.workProducts('issue-1'),
      issueKeys.detail('ws-1', 'issue-1'),
      issueKeys.pendingApproval('issue-1'),
      issueKeys.list('ws-1'),
      inboxKeys.list('ws-1'),
    ])
  })
})
