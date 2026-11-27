import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Issue } from '@garden/core/types'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { issueKeys } from '@/lib/issues/queries'
import { IssueMentionCard } from './issue-mention-card'

const api = vi.hoisted(() => ({ getIssue: vi.fn(), listIssues: vi.fn() }))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  api,
}))
vi.mock(
  '@/features/navigation/use-surface-navigation',
  async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    useSurfaceNavigation: () => ({ openIssue: vi.fn() }),
  }),
)

const ISSUE = {
  id: 'issue-1',
  identifier: 'GAR-1',
  title: 'Fix login',
  status: 'todo',
  priority: 'none',
} as Issue

function renderMention(seed?: (queryClient: QueryClient) => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  seed?.(queryClient)
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">
        <IssueMentionCard issueId="issue-1" />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
}

describe('IssueMentionCard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the list cache when it has the issue', async () => {
    renderMention((qc) =>
      qc.setQueryData(issueKeys.list('ws-1'), {
        issues: [ISSUE],
        total: 1,
        doneTotal: 0,
      }),
    )
    expect(await screen.findByText(/Fix login/)).toBeInTheDocument()
    expect(api.getIssue).not.toHaveBeenCalled()
  })

  it('fetches just the issue, not the whole list, when nothing is cached', async () => {
    api.getIssue.mockResolvedValue(ISSUE)
    renderMention()
    expect(await screen.findByText(/Fix login/)).toBeInTheDocument()
    expect(api.getIssue).toHaveBeenCalledTimes(1)
    expect(api.listIssues).not.toHaveBeenCalled()
  })
})
